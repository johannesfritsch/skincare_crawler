#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# AnySkin Crawler — Deployment CLI
#
# Multi-environment deployment orchestrator.
# Manages staging and prod environments on a single server.
#
# Usage:
#   ./deploy.sh <command> [args]
#   ./deploy.sh help
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $1"; }
error() { echo -e "${RED}[deploy]${NC} $1"; }
header() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

BASE_DIR="/srv/anyskin"
mkdir -p "$BASE_DIR"
REPO_URL="git@github.com:johannesfritsch/skincare_crawler.git"
DB_USER="anyskin"
DB_PASS="anyskin"
STAGING_PORT=3001
PROD_PORT=3000
STAGING_DOMAIN="staging.xploy.com"
PROD_DOMAIN="www.xploy.com"
PROD_REDIRECT_DOMAIN="xploy.com"  # redirects to PROD_DOMAIN

# ─── Helpers ─────────────────────────────────────────────────────────

validate_env() {
  local env="${1:-}"
  if [[ "$env" != "staging" && "$env" != "prod" ]]; then
    error "Invalid environment: '$env'. Must be 'staging' or 'prod'."
    exit 1
  fi
}

env_dir() { echo "$BASE_DIR/$1"; }

env_port() {
  if [[ "$1" == "staging" ]]; then echo "$STAGING_PORT"; else echo "$PROD_PORT"; fi
}

db_name() { echo "anyskin_$1"; }

detect_pkg_mgr() {
  if command -v pnpm &>/dev/null; then
    echo "pnpm"
  elif command -v bun &>/dev/null; then
    echo "bun"
  else
    error "Neither pnpm nor bun found."
    exit 1
  fi
}

# ─── setup ───────────────────────────────────────────────────────────

cmd_setup() {
  header "One-time server setup"

  local OS
  OS="$(uname -s)"

  if [[ "$OS" != "Linux" ]]; then
    error "Server setup is only supported on Linux (Debian/Ubuntu)."
    exit 1
  fi

  if ! command -v apt-get &>/dev/null; then
    error "Only Debian/Ubuntu (apt-get) is supported."
    exit 1
  fi

  info "Installing system dependencies..."
  apt-get update -qq

  # Core tools
  apt-get install -y -qq curl git build-essential

  # FFmpeg
  apt-get install -y -qq ffmpeg
  info "  ffmpeg"

  # yt-dlp (latest binary)
  curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
  info "  yt-dlp"

  # gallery-dl
  apt-get install -y -qq python3-pip
  pip3 install -q gallery-dl 2>/dev/null || pip3 install -q --break-system-packages gallery-dl
  info "  gallery-dl"

  # zbar (barcode scanning)
  apt-get install -y -qq zbar-tools
  info "  zbar"

  # Libraries for sharp + onnxruntime
  apt-get install -y -qq libvips-dev libomp-dev
  info "  libvips, libomp"

  # PostgreSQL
  if ! command -v psql &>/dev/null; then
    info "Installing PostgreSQL..."
    apt-get install -y -qq postgresql postgresql-client
    systemctl enable postgresql
    systemctl start postgresql
  fi
  info "  postgresql"

  # Node.js via nvm (if not present)
  if ! command -v node &>/dev/null; then
    info "Installing Node.js via nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    # nvm.sh doesn't handle set -u (nounset) — disable temporarily
    set +u
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install --lts
    nvm use --lts
    set -u
  fi
  info "  node $(node --version)"

  # pnpm
  if ! command -v pnpm &>/dev/null; then
    npm install -g pnpm
  fi
  info "  pnpm $(pnpm --version)"

  # PM2
  if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
  fi
  info "  pm2 $(pm2 --version 2>/dev/null || echo 'installed')"

  # Create base directory
  mkdir -p "$BASE_DIR"

  # Setup PostgreSQL user
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
    info "Creating PostgreSQL user '$DB_USER'..."
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' CREATEDB;"
  fi
  info "  PostgreSQL user '$DB_USER' ready"

  header "Setup complete"
  info ""
  info "Next steps:"
  info "  1. Configure GitHub deploy key (if not done):"
  info "       ssh-keygen -t ed25519 -C anyskin-deploy -f ~/.ssh/anyskin_deploy -N \"\""
  info "       cat ~/.ssh/anyskin_deploy.pub  # → add as deploy key in GitHub"
  info "       echo -e 'Host github.com\n  IdentityFile ~/.ssh/anyskin_deploy\n  IdentitiesOnly yes' >> ~/.ssh/config"
  info ""
  info "  2. Initialize environments:"
  info "       ./deploy.sh init staging --workers 2"
  info "       ./deploy.sh init prod --workers 1"
  info ""
  info "  3. Configure .env files (API keys, SMTP, S3, etc.)"
  info ""
  info "  4. Setup Nginx + SSL:"
  info "       ./deploy.sh ssl your@email.com"
  info ""
  info "  5. Start services:"
  info "       ./deploy.sh start staging"
  info "       ./deploy.sh start prod"
}

# ─── init ────────────────────────────────────────────────────────────

cmd_init() {
  local env="${1:-}"
  validate_env "$env"
  shift

  # Parse --workers flag
  local workers=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --workers) workers="${2:-1}"; shift 2 ;;
      --workers=*) workers="${1#*=}"; shift ;;
      *) error "Unknown option: $1"; exit 1 ;;
    esac
  done

  local dir
  dir="$(env_dir "$env")"
  local port
  port="$(env_port "$env")"
  local db
  db="$(db_name "$env")"
  local pkg
  pkg="$(detect_pkg_mgr)"

  header "Initializing $env environment"
  info "Directory: $dir"
  info "Port: $port"
  info "Database: $db"
  info "Workers: $workers"

  # Clone repo
  if [[ -d "$dir/.git" ]]; then
    info "Repository already cloned, pulling latest..."
    cd "$dir" && git fetch origin && git reset --hard origin/main
  else
    info "Cloning repository..."
    mkdir -p "$dir"
    git clone "$REPO_URL" "$dir"
  fi

  # Install npm dependencies
  cd "$dir"
  info "Installing npm packages..."
  $pkg install

  # Playwright
  info "Installing Playwright Chromium..."
  cd "$dir/worker"
  ./node_modules/.bin/playwright install --with-deps chromium
  cd "$dir"

  # Create database
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_databases WHERE datname='$db'" 2>/dev/null | grep -q 1; then
    info "Database '$db' already exists"
  else
    info "Creating database '$db'..."
    sudo -u postgres createdb -O "$DB_USER" "$db"
  fi

  # Scaffold server .env
  if [[ ! -f "$dir/server/.env" ]]; then
    info "Scaffolding server/.env..."
    cp "$dir/server/.env.example" "$dir/server/.env"
    # Patch DATABASE_URL and port
    sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$db|" "$dir/server/.env"
    sed -i "s|PAYLOAD_SECRET=.*|PAYLOAD_SECRET=$(openssl rand -hex 32)|" "$dir/server/.env"
    info "  server/.env created — edit to configure SMTP, S3, etc."
  else
    info "  server/.env already exists, skipping"
  fi

  # Scaffold per-worker .env files
  for i in $(seq 1 "$workers"); do
    local wenv="$dir/worker/.env.$i"
    if [[ ! -f "$wenv" ]]; then
      info "Scaffolding worker/.env.$i..."
      cp "$dir/worker/.env.example" "$wenv"
      sed -i "s|WORKER_SERVER_URL=.*|WORKER_SERVER_URL=http://localhost:$port|" "$wenv"
      sed -i "s|WORKER_API_KEY=.*|WORKER_API_KEY=REPLACE_WITH_API_KEY_FOR_WORKER_$i|" "$wenv"
      info "  worker/.env.$i created — set WORKER_API_KEY after creating worker in admin UI"
    else
      info "  worker/.env.$i already exists, skipping"
    fi
  done

  # Generate PM2 ecosystem file
  info "Generating pm2.config.cjs..."
  generate_pm2_config "$env" "$dir" "$port" "$workers"
  info "  pm2.config.cjs created"

  # Run migrations
  info "Running database migrations..."
  cd "$dir/server"
  $pkg payload migrate

  # Generate types
  info "Generating TypeScript types..."
  $pkg generate:types
  $pkg generate:importmap

  header "$env environment initialized"
  info ""
  info "Next steps:"
  info "  1. Edit server/.env (SMTP, S3, etc.)"
  for i in $(seq 1 "$workers"); do
    info "  2. Create worker #$i in admin UI, paste API key into worker/.env.$i"
  done
  info "  3. ./deploy.sh start $env"
}

generate_pm2_config() {
  local env="$1" dir="$2" port="$3" workers="$4"

  local config="module.exports = {
  apps: [
    {
      name: 'anyskin-${env}-server',
      cwd: '${dir}/server',
      script: 'node_modules/.bin/next',
      args: 'start -p ${port}',
      node_args: '--env-file=.env',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      exp_backoff_restart_delay: 100,
    },"

  for i in $(seq 1 "$workers"); do
    config+="
    {
      name: 'anyskin-${env}-worker-${i}',
      cwd: '${dir}/worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/worker.ts',
      node_args: '--env-file=.env.${i}',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '2G',
      exp_backoff_restart_delay: 100,
    },"
  done

  config+="
  ],
}"

  echo "$config" > "$dir/pm2.config.cjs"
}

# ─── deploy ──────────────────────────────────────────────────────────

cmd_deploy() {
  local env="${1:-}"
  validate_env "$env"

  local dir
  dir="$(env_dir "$env")"
  local pkg
  pkg="$(detect_pkg_mgr)"

  if [[ ! -d "$dir/.git" ]]; then
    error "Environment '$env' not initialized. Run: ./deploy.sh init $env"
    exit 1
  fi

  header "Deploying $env"

  cd "$dir"

  # Pull latest
  info "Pulling latest code..."
  git fetch origin
  git reset --hard origin/main

  # Install dependencies
  info "Installing npm packages..."
  $pkg install

  # Run migrations
  info "Running database migrations..."
  cd "$dir/server"
  $pkg payload migrate

  # Generate types
  info "Generating TypeScript types..."
  $pkg generate:types
  $pkg generate:importmap

  # Restart processes
  info "Restarting processes..."
  cd "$dir"
  pm2 restart pm2.config.cjs

  header "$env deployed successfully"
}

# ─── start / stop / restart ──────────────────────────────────────────

cmd_start() {
  local env="${1:-}"
  validate_env "$env"
  local dir
  dir="$(env_dir "$env")"

  if [[ ! -f "$dir/pm2.config.cjs" ]]; then
    error "No pm2.config.cjs found. Run: ./deploy.sh init $env"
    exit 1
  fi

  header "Starting $env"
  cd "$dir"
  pm2 start pm2.config.cjs
  pm2 save
  info "All processes started."
}

cmd_stop() {
  local env="${1:-}"
  validate_env "$env"

  header "Stopping $env"
  # Stop all processes matching the env prefix
  pm2 list | grep "anyskin-${env}-" | awk '{print $4}' | while read -r name; do
    pm2 stop "$name" 2>/dev/null || true
  done
  pm2 save
  info "All $env processes stopped."
}

cmd_restart() {
  local env="${1:-}"
  validate_env "$env"
  local dir
  dir="$(env_dir "$env")"

  header "Restarting $env"
  cd "$dir"
  pm2 restart pm2.config.cjs
  pm2 save
  info "All $env processes restarted."
}

# ─── logs ────────────────────────────────────────────────────────────

cmd_logs() {
  local env="${1:-}"
  validate_env "$env"
  local service="${2:-}"

  if [[ -n "$service" ]]; then
    case "$service" in
      server) pm2 logs "anyskin-${env}-server" ;;
      worker) pm2 logs "anyskin-${env}-worker-1" ;;
      worker-*) pm2 logs "anyskin-${env}-${service}" ;;
      *) error "Unknown service: $service. Use: server, worker, worker-N"; exit 1 ;;
    esac
  else
    # Show all logs for this env
    pm2 logs --lines 50 | grep "anyskin-${env}" || pm2 logs
  fi
}

# ─── status ──────────────────────────────────────────────────────────

cmd_status() {
  local env="${1:-}"

  header "System dependencies"
  local FAILED=0
  for cmd in ffmpeg ffprobe yt-dlp gallery-dl zbarimg node pnpm pm2 psql; do
    if command -v "$cmd" &>/dev/null; then
      info "  $cmd"
    else
      error "  $cmd — NOT FOUND"
      FAILED=1
    fi
  done

  header "PostgreSQL"
  if systemctl is-active --quiet postgresql 2>/dev/null; then
    info "  PostgreSQL is running"
  else
    warn "  PostgreSQL is not running"
  fi

  # Show env-specific status
  local envs
  if [[ -n "$env" ]]; then
    validate_env "$env"
    envs=("$env")
  else
    envs=("staging" "prod")
  fi

  for e in "${envs[@]}"; do
    local dir
    dir="$(env_dir "$e")"
    local db
    db="$(db_name "$e")"

    header "Environment: $e"

    # Directory
    if [[ -d "$dir/.git" ]]; then
      local branch commit
      branch=$(cd "$dir" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
      commit=$(cd "$dir" && git log --oneline -1 2>/dev/null || echo "?")
      info "  Repo: $dir ($branch) $commit"
    else
      warn "  Not initialized — run: ./deploy.sh init $e"
      continue
    fi

    # .env files
    if [[ -f "$dir/server/.env" ]]; then
      info "  server/.env exists"
    else
      warn "  server/.env MISSING"
    fi
    for f in "$dir"/worker/.env.*; do
      if [[ -f "$f" ]]; then
        info "  $(basename "$f") exists"
      fi
    done

    # Database
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" 2>/dev/null | grep -q 1; then
      info "  Database '$db' exists"
    else
      warn "  Database '$db' not found"
    fi

    # PM2 processes
    if pm2 list 2>/dev/null | grep -q "anyskin-${e}-"; then
      info "  PM2 processes:"
      pm2 list 2>/dev/null | grep "anyskin-${e}-" | while read -r line; do
        echo "    $line"
      done
    else
      warn "  No PM2 processes running"
    fi
  done
}

# ─── env ─────────────────────────────────────────────────────────────

cmd_env() {
  local env="${1:-}"
  validate_env "$env"
  local dir
  dir="$(env_dir "$env")"

  header "Environment files for $env"
  info "Server: $dir/server/.env"
  for f in "$dir"/worker/.env.*; do
    if [[ -f "$f" ]]; then
      info "Worker: $f"
    fi
  done
}

# ─── ssl ─────────────────────────────────────────────────────────────

cmd_ssl() {
  local email="${1:-}"
  if [[ -z "$email" ]]; then
    error "Usage: ./deploy.sh ssl <email>"
    error "  Email is required for Let's Encrypt certificate registration."
    exit 1
  fi

  header "Setting up Nginx + Let's Encrypt SSL"

  # Install nginx + certbot
  info "Installing Nginx and Certbot..."
  apt-get update -qq
  apt-get install -y -qq nginx certbot python3-certbot-nginx

  # Generate Nginx config for staging
  info "Configuring Nginx for $STAGING_DOMAIN → localhost:$STAGING_PORT"
  cat > /etc/nginx/sites-available/anyskin-staging << NGINX_EOF
server {
    listen 80;
    server_name $STAGING_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$STAGING_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        client_max_body_size 500M;
    }
}
NGINX_EOF

  # Generate Nginx config for prod (www + redirect from bare domain)
  info "Configuring Nginx for $PROD_DOMAIN → localhost:$PROD_PORT"
  cat > /etc/nginx/sites-available/anyskin-prod << NGINX_EOF
# Redirect bare domain to www
server {
    listen 80;
    server_name $PROD_REDIRECT_DOMAIN;
    return 301 https://$PROD_DOMAIN\$request_uri;
}

server {
    listen 80;
    server_name $PROD_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PROD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        client_max_body_size 500M;
    }
}
NGINX_EOF

  # Enable sites
  ln -sf /etc/nginx/sites-available/anyskin-staging /etc/nginx/sites-enabled/
  ln -sf /etc/nginx/sites-available/anyskin-prod /etc/nginx/sites-enabled/

  # Remove default site if it exists
  rm -f /etc/nginx/sites-enabled/default

  # Test config
  info "Testing Nginx configuration..."
  nginx -t

  # Reload nginx
  systemctl reload nginx
  info "Nginx configured and running."

  # Obtain SSL certificates
  header "Obtaining SSL certificates"
  info "Requesting certificate for $STAGING_DOMAIN..."
  certbot --nginx -d "$STAGING_DOMAIN" --non-interactive --agree-tos -m "$email"

  info "Requesting certificate for $PROD_DOMAIN and $PROD_REDIRECT_DOMAIN..."
  certbot --nginx -d "$PROD_DOMAIN" -d "$PROD_REDIRECT_DOMAIN" --non-interactive --agree-tos -m "$email"

  # Certbot auto-renewal is installed by default via systemd timer
  info "SSL auto-renewal is handled by certbot systemd timer."

  header "SSL setup complete"
  info ""
  info "  https://$STAGING_DOMAIN → staging (port $STAGING_PORT)"
  info "  https://$PROD_DOMAIN → prod (port $PROD_PORT)"
  info "  https://$PROD_REDIRECT_DOMAIN → redirects to https://$PROD_DOMAIN"
}

# ─── help ────────────────────────────────────────────────────────────

cmd_help() {
  echo -e "${BOLD}AnySkin Crawler — Deployment CLI${NC}"
  echo ""
  echo "Usage: ./deploy.sh <command> [args]"
  echo ""
  echo -e "${BOLD}Commands:${NC}"
  echo "  setup                     Install system deps, Node.js, PM2, PostgreSQL"
  echo "  init <env> [--workers N]  Create environment (clone repo, scaffold .env, create DB)"
  echo "  deploy <env>              Pull latest, install, migrate, restart"
  echo "  start <env>               Start server + workers via PM2"
  echo "  stop <env>                Stop server + workers"
  echo "  restart <env>             Restart server + workers"
  echo "  logs <env> [service]      Tail logs (service: server, worker, worker-N)"
  echo "  status [env]              Show system and environment status"
  echo "  ssl <email>               Setup Nginx + Let's Encrypt SSL for all domains"
  echo "  env <env>                 Show .env file paths"
  echo "  help                      Show this help"
  echo ""
  echo -e "${BOLD}Environments:${NC} staging, prod"
  echo ""
  echo -e "${BOLD}Examples:${NC}"
  echo "  ./deploy.sh setup                  # First-time server setup"
  echo "  ./deploy.sh init staging --workers 2"
  echo "  ./deploy.sh deploy prod            # Deploy latest to prod"
  echo "  ./deploy.sh logs staging worker    # Tail staging worker logs"
}

# ─── Dispatch ────────────────────────────────────────────────────────

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  setup)    cmd_setup "$@" ;;
  init)     cmd_init "$@" ;;
  deploy)   cmd_deploy "$@" ;;
  start)    cmd_start "$@" ;;
  stop)     cmd_stop "$@" ;;
  restart)  cmd_restart "$@" ;;
  logs)     cmd_logs "$@" ;;
  status)   cmd_status "$@" ;;
  ssl)      cmd_ssl "$@" ;;
  env)      cmd_env "$@" ;;
  help|*)   cmd_help ;;
esac
