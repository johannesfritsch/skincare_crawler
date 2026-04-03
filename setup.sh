#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# AnySkin Crawler — System dependency setup
#
# Installs all system-level dependencies required by the worker and server.
# Run once on a fresh machine, or after major dependency changes.
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $1"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $1"; }
error() { echo -e "${RED}[setup]${NC} $1"; }

OS="$(uname -s)"
ARCH="$(uname -m)"

info "Detected: OS=$OS ARCH=$ARCH"

# ─── macOS ────────────────────────────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then

  # Check for Homebrew
  if ! command -v brew &>/dev/null; then
    error "Homebrew is required. Install it from https://brew.sh"
    exit 1
  fi

  info "Installing system dependencies via Homebrew..."

  # FFmpeg (includes ffprobe)
  brew list ffmpeg &>/dev/null || brew install ffmpeg
  info "✓ ffmpeg"

  # yt-dlp
  brew list yt-dlp &>/dev/null || brew install yt-dlp
  info "✓ yt-dlp"

  # gallery-dl (Instagram/TikTok metadata extraction)
  brew list gallery-dl &>/dev/null || brew install gallery-dl
  info "✓ gallery-dl"

  # zbar (barcode scanning)
  brew list zbar &>/dev/null || brew install zbar
  info "✓ zbar"

  # vips (required by sharp)
  brew list vips &>/dev/null || brew install vips
  info "✓ vips (for sharp)"

  info "macOS system dependencies installed."

# ─── Linux (Debian/Ubuntu) ───────────────────────────────────────────
elif [[ "$OS" == "Linux" ]]; then

  if ! command -v apt-get &>/dev/null; then
    error "Only Debian/Ubuntu (apt-get) is supported. Adapt for your distro."
    exit 1
  fi

  info "Installing system dependencies via apt..."

  apt-get update -qq

  # FFmpeg (includes ffprobe)
  apt-get install -y -qq ffmpeg
  info "✓ ffmpeg"

  # yt-dlp — always install latest binary (apt version is usually years outdated)
  curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod +x /usr/local/bin/yt-dlp
  info "✓ yt-dlp"

  # gallery-dl (Instagram/TikTok metadata extraction)
  apt-get install -y -qq python3-pip
  pip3 install -q gallery-dl 2>/dev/null || pip3 install -q --break-system-packages gallery-dl
  info "✓ gallery-dl"

  # zbar (barcode scanning)
  apt-get install -y -qq zbar-tools
  info "✓ zbar"

  # Libraries for sharp (libvips) and onnxruntime-node (OpenMP)
  apt-get install -y -qq libvips-dev libomp-dev
  info "✓ libvips, libomp (for sharp & onnxruntime)"

  info "Linux system dependencies installed."

else
  error "Unsupported OS: $OS"
  exit 1
fi

# ─── Node.js dependencies ────────────────────────────────────────────
info "Checking Node.js tooling..."

# Check for bun or pnpm
if command -v bun &>/dev/null; then
  PKG_MGR="bun"
elif command -v pnpm &>/dev/null; then
  PKG_MGR="pnpm"
else
  error "Neither bun nor pnpm found. Install one of them first."
  exit 1
fi
info "Using $PKG_MGR as package manager"

# Install npm dependencies
info "Installing npm packages..."
$PKG_MGR install

# Playwright bundled Chromium (with system deps on Linux)
info "Installing Playwright Chromium..."
if [[ "$OS" == "Linux" ]]; then
  ./worker/node_modules/.bin/playwright install --with-deps chromium
else
  ./worker/node_modules/.bin/playwright install chromium
fi
info "✓ Playwright Chromium"

# ─── Verify ──────────────────────────────────────────────────────────
info ""
info "Verifying installations..."

FAILED=0
for cmd in ffmpeg ffprobe yt-dlp gallery-dl zbarimg; do
  if command -v "$cmd" &>/dev/null; then
    info "  ✓ $cmd ($(command -v "$cmd"))"
  else
    error "  ✗ $cmd — NOT FOUND"
    FAILED=1
  fi
done

# Check Playwright Chromium
CHROMIUM_PATH=$(cd worker && node -e "try { console.log(require('playwright-core').chromium.executablePath()) } catch { console.log('') }" 2>/dev/null || echo "")
if [[ -n "$CHROMIUM_PATH" && -f "$CHROMIUM_PATH" ]]; then
  info "  ✓ Playwright Chromium ($CHROMIUM_PATH)"
else
  warn "  ⚠ Playwright Chromium not found at expected path"
fi

if [[ "$FAILED" -eq 1 ]]; then
  error "Some dependencies are missing. Check the errors above."
  exit 1
fi

info ""
info "All system dependencies installed successfully!"
info ""
info "Next steps:"
info "  1. Copy server/.env.example to server/.env and configure"
info "  2. Copy worker/.env.example to worker/.env and configure"
info "  3. Run migrations: cd server && $PKG_MGR payload migrate"
info "  4. Start server:   cd server && $PKG_MGR dev"
info "  5. Start worker:   cd worker && $PKG_MGR worker"
