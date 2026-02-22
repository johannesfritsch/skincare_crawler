import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_source_categories_source" AS ENUM('dm', 'mueller', 'rossmann');
  CREATE TYPE "public"."enum_ingredients_status" AS ENUM('pending', 'crawled', 'crawl_failed', 'crawl_not_found');
  CREATE TYPE "public"."enum_ingredients_item_type" AS ENUM('ingredient', 'substance');
  CREATE TYPE "public"."enum_ingredients_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_products_product_attributes_attribute" AS ENUM('containsAllergens', 'containsSimpleAlcohol', 'containsGluten', 'containsSilicones', 'containsSulfates', 'containsParabens', 'containsPegs', 'containsFragrance', 'containsMineralOil');
  CREATE TYPE "public"."enum_products_product_attributes_evidence_type" AS ENUM('ingredient', 'descriptionSnippet');
  CREATE TYPE "public"."enum_products_product_claims_claim" AS ENUM('vegan', 'crueltyFree', 'unsafeForPregnancy', 'pregnancySafe', 'waterProof', 'microplasticFree', 'allergenFree', 'simpleAlcoholFree', 'glutenFree', 'siliconeFree', 'sulfateFree', 'parabenFree', 'pegFree', 'fragranceFree', 'mineralOilFree');
  CREATE TYPE "public"."enum_products_product_claims_evidence_type" AS ENUM('ingredient', 'descriptionSnippet');
  CREATE TYPE "public"."enum_source_products_status" AS ENUM('uncrawled', 'crawled');
  CREATE TYPE "public"."enum_source_products_source" AS ENUM('dm', 'mueller', 'rossmann');
  CREATE TYPE "public"."enum_product_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_product_crawls_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_product_crawls_source" AS ENUM('all', 'dm', 'rossmann', 'mueller');
  CREATE TYPE "public"."enum_product_crawls_type" AS ENUM('all', 'selected_urls', 'selected_gtins', 'from_discovery');
  CREATE TYPE "public"."enum_product_crawls_scope" AS ENUM('uncrawled_only', 'recrawl');
  CREATE TYPE "public"."enum_product_crawls_min_crawl_age_unit" AS ENUM('minutes', 'hours', 'days', 'weeks');
  CREATE TYPE "public"."enum_product_aggregations_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_product_aggregations_type" AS ENUM('all', 'selected_gtins');
  CREATE TYPE "public"."enum_product_aggregations_language" AS ENUM('de', 'en');
  CREATE TYPE "public"."enum_category_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_events_type" AS ENUM('start', 'success', 'info', 'warning', 'error');
  CREATE TYPE "public"."enum_events_level" AS ENUM('debug', 'info', 'warn', 'error');
  CREATE TYPE "public"."enum_events_component" AS ENUM('worker', 'server');
  CREATE TYPE "public"."enum_channels_platform" AS ENUM('youtube', 'instagram', 'tiktok');
  CREATE TYPE "public"."enum_videos_processing_status" AS ENUM('unprocessed', 'processed');
  CREATE TYPE "public"."enum_video_snippets_matching_type" AS ENUM('barcode', 'visual');
  CREATE TYPE "public"."enum_video_discoveries_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_video_processings_status" AS ENUM('pending', 'in_progress', 'completed', 'failed');
  CREATE TYPE "public"."enum_video_processings_type" AS ENUM('all_unprocessed', 'single_video', 'selected_urls');
  CREATE TYPE "public"."enum_workers_capabilities" AS ENUM('product-crawl', 'product-discovery', 'category-discovery', 'ingredients-discovery', 'video-discovery', 'video-processing', 'product-aggregation');
  CREATE TYPE "public"."enum_workers_status" AS ENUM('active', 'disabled');
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "brands" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar,
  	"parent_id" integer,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "product_types" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"name_d_e" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "source_categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"parent_id" integer,
  	"source" "enum_source_categories_source" NOT NULL,
  	"url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ingredients_functions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"function" varchar
  );
  
  CREATE TABLE "ingredients" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"status" "enum_ingredients_status" DEFAULT 'pending',
  	"description" varchar,
  	"cas_number" varchar,
  	"ec_number" varchar,
  	"cos_ing_id" varchar,
  	"chemical_description" varchar,
  	"item_type" "enum_ingredients_item_type",
  	"restrictions" varchar,
  	"source_url" varchar,
  	"crawled_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ingredients_discoveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source_url" varchar NOT NULL,
  	"status" "enum_ingredients_discoveries_status" DEFAULT 'pending',
  	"discovered" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"existing" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"current_term" varchar,
  	"current_page" numeric,
  	"total_pages_for_term" numeric,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"term_queue" jsonb,
  	"pages_per_tick" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_ingredients" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"ingredient_id" integer
  );
  
  CREATE TABLE "products_product_attributes_ingredient_names" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar
  );
  
  CREATE TABLE "products_product_attributes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"attribute" "enum_products_product_attributes_attribute" NOT NULL,
  	"source_product_id" integer NOT NULL,
  	"evidence_type" "enum_products_product_attributes_evidence_type" NOT NULL,
  	"snippet" varchar,
  	"start" numeric,
  	"end" numeric
  );
  
  CREATE TABLE "products_product_claims_ingredient_names" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar
  );
  
  CREATE TABLE "products_product_claims" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"claim" "enum_products_product_claims_claim" NOT NULL,
  	"source_product_id" integer NOT NULL,
  	"evidence_type" "enum_products_product_claims_evidence_type" NOT NULL,
  	"snippet" varchar,
  	"start" numeric,
  	"end" numeric
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"gtin" varchar,
  	"description" varchar,
  	"brand_id" integer,
  	"category_id" integer,
  	"product_type_id" integer,
  	"published_at" timestamp(3) with time zone,
  	"last_aggregated_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"source_products_id" integer
  );
  
  CREATE TABLE "source_products_labels" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "source_products_images" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"url" varchar NOT NULL,
  	"alt" varchar
  );
  
  CREATE TABLE "source_products_variants_options" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"value" varchar,
  	"gtin" varchar,
  	"is_selected" boolean DEFAULT false
  );
  
  CREATE TABLE "source_products_variants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"dimension" varchar NOT NULL
  );
  
  CREATE TABLE "source_products_price_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"recorded_at" timestamp(3) with time zone NOT NULL,
  	"amount" numeric,
  	"currency" varchar DEFAULT 'EUR',
  	"per_unit_amount" numeric,
  	"per_unit_currency" varchar DEFAULT 'EUR',
  	"per_unit_quantity" numeric,
  	"unit" varchar
  );
  
  CREATE TABLE "source_products_ingredients" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL
  );
  
  CREATE TABLE "source_products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"gtin" varchar,
  	"status" "enum_source_products_status" DEFAULT 'uncrawled',
  	"source_url" varchar,
  	"source" "enum_source_products_source",
  	"source_article_number" varchar,
  	"brand_name" varchar,
  	"name" varchar,
  	"source_category_id" integer,
  	"rating" numeric,
  	"rating_num" numeric,
  	"amount" numeric,
  	"amount_unit" varchar,
  	"description" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "product_discoveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source_urls" varchar NOT NULL,
  	"status" "enum_product_discoveries_status" DEFAULT 'pending',
  	"discovered" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"existing" numeric DEFAULT 0,
  	"progress" jsonb,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"product_urls" varchar,
  	"items_per_tick" numeric,
  	"delay" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "product_crawls" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_product_crawls_status" DEFAULT 'pending',
  	"source" "enum_product_crawls_source" DEFAULT 'all' NOT NULL,
  	"type" "enum_product_crawls_type" DEFAULT 'all' NOT NULL,
  	"urls" varchar,
  	"gtins" varchar,
  	"discovery_id" integer,
  	"scope" "enum_product_crawls_scope" DEFAULT 'uncrawled_only' NOT NULL,
  	"min_crawl_age" numeric,
  	"min_crawl_age_unit" "enum_product_crawls_min_crawl_age_unit" DEFAULT 'days',
  	"total" numeric,
  	"crawled" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"debug" boolean DEFAULT false,
  	"items_per_tick" numeric DEFAULT 10,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "product_aggregations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_product_aggregations_status" DEFAULT 'pending',
  	"type" "enum_product_aggregations_type" DEFAULT 'all' NOT NULL,
  	"gtins" varchar,
  	"language" "enum_product_aggregations_language" DEFAULT 'de',
  	"total" numeric,
  	"aggregated" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"tokens_used" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"items_per_tick" numeric DEFAULT 10,
  	"product_id" integer,
  	"last_checked_source_id" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "crawl_results" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"crawl_id" integer NOT NULL,
  	"source_product_id" integer NOT NULL,
  	"error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "discovery_results" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"discovery_id" integer NOT NULL,
  	"source_product_id" integer NOT NULL,
  	"error" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "category_discoveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"store_urls" varchar NOT NULL,
  	"status" "enum_category_discoveries_status" DEFAULT 'pending',
  	"discovered" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"existing" numeric DEFAULT 0,
  	"progress" jsonb,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"category_urls" varchar,
  	"error_urls" varchar,
  	"items_per_tick" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "events_labels" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL
  );
  
  CREATE TABLE "events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"type" "enum_events_type" DEFAULT 'error' NOT NULL,
  	"level" "enum_events_level" DEFAULT 'info',
  	"component" "enum_events_component" DEFAULT 'worker',
  	"message" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "events_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"product_discoveries_id" integer,
  	"product_crawls_id" integer,
  	"ingredients_discoveries_id" integer,
  	"product_aggregations_id" integer,
  	"video_discoveries_id" integer,
  	"video_processings_id" integer,
  	"category_discoveries_id" integer
  );
  
  CREATE TABLE "creators" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "channels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"creator_id" integer NOT NULL,
  	"image_id" integer,
  	"platform" "enum_channels_platform" NOT NULL,
  	"external_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "videos" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"channel_id" integer NOT NULL,
  	"title" varchar NOT NULL,
  	"image_id" integer,
  	"published_at" timestamp(3) with time zone,
  	"processing_status" "enum_videos_processing_status" DEFAULT 'unprocessed',
  	"duration" numeric,
  	"view_count" numeric,
  	"like_count" numeric,
  	"external_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "video_snippets_screenshots" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"thumbnail_id" integer,
  	"hash" varchar,
  	"distance" numeric,
  	"screenshot_group" numeric,
  	"barcode" varchar,
  	"recognition_candidate" boolean,
  	"recognition_thumbnail_id" integer
  );
  
  CREATE TABLE "video_snippets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"matching_type" "enum_video_snippets_matching_type",
  	"video_id" integer NOT NULL,
  	"image_id" integer,
  	"timestamp_start" numeric,
  	"timestamp_end" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "video_snippets_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer
  );
  
  CREATE TABLE "video_discoveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"channel_url" varchar NOT NULL,
  	"status" "enum_video_discoveries_status" DEFAULT 'pending',
  	"discovered" numeric DEFAULT 0,
  	"created" numeric DEFAULT 0,
  	"existing" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"items_per_tick" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "video_processings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"status" "enum_video_processings_status" DEFAULT 'pending',
  	"type" "enum_video_processings_type" DEFAULT 'all_unprocessed' NOT NULL,
  	"video_id" integer,
  	"urls" varchar,
  	"scene_threshold" numeric DEFAULT 0.4,
  	"cluster_threshold" numeric DEFAULT 25,
  	"total" numeric,
  	"processed" numeric DEFAULT 0,
  	"errors" numeric DEFAULT 0,
  	"tokens_used" numeric DEFAULT 0,
  	"started_at" timestamp(3) with time zone,
  	"completed_at" timestamp(3) with time zone,
  	"items_per_tick" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "workers_capabilities" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_workers_capabilities",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "workers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"status" "enum_workers_status" DEFAULT 'active' NOT NULL,
  	"last_seen_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"media_id" integer,
  	"brands_id" integer,
  	"categories_id" integer,
  	"product_types_id" integer,
  	"source_categories_id" integer,
  	"ingredients_id" integer,
  	"ingredients_discoveries_id" integer,
  	"products_id" integer,
  	"source_products_id" integer,
  	"product_discoveries_id" integer,
  	"product_crawls_id" integer,
  	"product_aggregations_id" integer,
  	"crawl_results_id" integer,
  	"discovery_results_id" integer,
  	"category_discoveries_id" integer,
  	"events_id" integer,
  	"creators_id" integer,
  	"channels_id" integer,
  	"videos_id" integer,
  	"video_snippets_id" integer,
  	"video_discoveries_id" integer,
  	"video_processings_id" integer,
  	"workers_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"workers_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "source_categories" ADD CONSTRAINT "source_categories_parent_id_source_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."source_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ingredients_functions" ADD CONSTRAINT "ingredients_functions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_ingredients" ADD CONSTRAINT "products_ingredients_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_ingredients" ADD CONSTRAINT "products_ingredients_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_product_attributes_ingredient_names" ADD CONSTRAINT "products_product_attributes_ingredient_names_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_product_attributes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_product_attributes" ADD CONSTRAINT "products_product_attributes_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_product_attributes" ADD CONSTRAINT "products_product_attributes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_product_claims_ingredient_names" ADD CONSTRAINT "products_product_claims_ingredient_names_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_product_claims"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_product_claims" ADD CONSTRAINT "products_product_claims_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_product_claims" ADD CONSTRAINT "products_product_claims_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_source_products_fk" FOREIGN KEY ("source_products_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_labels" ADD CONSTRAINT "source_products_labels_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_images" ADD CONSTRAINT "source_products_images_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_variants_options" ADD CONSTRAINT "source_products_variants_options_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products_variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_variants" ADD CONSTRAINT "source_products_variants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_price_history" ADD CONSTRAINT "source_products_price_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products_ingredients" ADD CONSTRAINT "source_products_ingredients_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "source_products" ADD CONSTRAINT "source_products_source_category_id_source_categories_id_fk" FOREIGN KEY ("source_category_id") REFERENCES "public"."source_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_crawls" ADD CONSTRAINT "product_crawls_discovery_id_product_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."product_discoveries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "product_aggregations" ADD CONSTRAINT "product_aggregations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "crawl_results" ADD CONSTRAINT "crawl_results_crawl_id_product_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."product_crawls"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "crawl_results" ADD CONSTRAINT "crawl_results_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_discovery_id_product_discoveries_id_fk" FOREIGN KEY ("discovery_id") REFERENCES "public"."product_discoveries"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "discovery_results" ADD CONSTRAINT "discovery_results_source_product_id_source_products_id_fk" FOREIGN KEY ("source_product_id") REFERENCES "public"."source_products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events_labels" ADD CONSTRAINT "events_labels_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_product_discoveries_fk" FOREIGN KEY ("product_discoveries_id") REFERENCES "public"."product_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_product_crawls_fk" FOREIGN KEY ("product_crawls_id") REFERENCES "public"."product_crawls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_ingredients_discoveries_fk" FOREIGN KEY ("ingredients_discoveries_id") REFERENCES "public"."ingredients_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_product_aggregations_fk" FOREIGN KEY ("product_aggregations_id") REFERENCES "public"."product_aggregations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_video_discoveries_fk" FOREIGN KEY ("video_discoveries_id") REFERENCES "public"."video_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_video_processings_fk" FOREIGN KEY ("video_processings_id") REFERENCES "public"."video_processings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "events_rels" ADD CONSTRAINT "events_rels_category_discoveries_fk" FOREIGN KEY ("category_discoveries_id") REFERENCES "public"."category_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "creators" ADD CONSTRAINT "creators_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "channels" ADD CONSTRAINT "channels_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "channels" ADD CONSTRAINT "channels_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "videos" ADD CONSTRAINT "videos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_thumbnail_id_media_id_fk" FOREIGN KEY ("thumbnail_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_recognition_thumbnail_id_media_id_fk" FOREIGN KEY ("recognition_thumbnail_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_screenshots" ADD CONSTRAINT "video_snippets_screenshots_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_snippets" ADD CONSTRAINT "video_snippets_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets" ADD CONSTRAINT "video_snippets_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "video_snippets_rels" ADD CONSTRAINT "video_snippets_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_snippets_rels" ADD CONSTRAINT "video_snippets_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "video_processings" ADD CONSTRAINT "video_processings_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workers_capabilities" ADD CONSTRAINT "workers_capabilities_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_brands_fk" FOREIGN KEY ("brands_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_types_fk" FOREIGN KEY ("product_types_id") REFERENCES "public"."product_types"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_categories_fk" FOREIGN KEY ("source_categories_id") REFERENCES "public"."source_categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingredients_fk" FOREIGN KEY ("ingredients_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ingredients_discoveries_fk" FOREIGN KEY ("ingredients_discoveries_id") REFERENCES "public"."ingredients_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_source_products_fk" FOREIGN KEY ("source_products_id") REFERENCES "public"."source_products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_discoveries_fk" FOREIGN KEY ("product_discoveries_id") REFERENCES "public"."product_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_crawls_fk" FOREIGN KEY ("product_crawls_id") REFERENCES "public"."product_crawls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_aggregations_fk" FOREIGN KEY ("product_aggregations_id") REFERENCES "public"."product_aggregations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_crawl_results_fk" FOREIGN KEY ("crawl_results_id") REFERENCES "public"."crawl_results"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_discovery_results_fk" FOREIGN KEY ("discovery_results_id") REFERENCES "public"."discovery_results"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_category_discoveries_fk" FOREIGN KEY ("category_discoveries_id") REFERENCES "public"."category_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_creators_fk" FOREIGN KEY ("creators_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_channels_fk" FOREIGN KEY ("channels_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_videos_fk" FOREIGN KEY ("videos_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_snippets_fk" FOREIGN KEY ("video_snippets_id") REFERENCES "public"."video_snippets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_discoveries_fk" FOREIGN KEY ("video_discoveries_id") REFERENCES "public"."video_discoveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_video_processings_fk" FOREIGN KEY ("video_processings_id") REFERENCES "public"."video_processings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_workers_fk" FOREIGN KEY ("workers_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_workers_fk" FOREIGN KEY ("workers_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "brands_updated_at_idx" ON "brands" USING btree ("updated_at");
  CREATE INDEX "brands_created_at_idx" ON "brands" USING btree ("created_at");
  CREATE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE UNIQUE INDEX "product_types_slug_idx" ON "product_types" USING btree ("slug");
  CREATE INDEX "product_types_updated_at_idx" ON "product_types" USING btree ("updated_at");
  CREATE INDEX "product_types_created_at_idx" ON "product_types" USING btree ("created_at");
  CREATE INDEX "source_categories_slug_idx" ON "source_categories" USING btree ("slug");
  CREATE INDEX "source_categories_parent_idx" ON "source_categories" USING btree ("parent_id");
  CREATE INDEX "source_categories_source_idx" ON "source_categories" USING btree ("source");
  CREATE INDEX "source_categories_url_idx" ON "source_categories" USING btree ("url");
  CREATE INDEX "source_categories_updated_at_idx" ON "source_categories" USING btree ("updated_at");
  CREATE INDEX "source_categories_created_at_idx" ON "source_categories" USING btree ("created_at");
  CREATE INDEX "ingredients_functions_order_idx" ON "ingredients_functions" USING btree ("_order");
  CREATE INDEX "ingredients_functions_parent_id_idx" ON "ingredients_functions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "ingredients_name_idx" ON "ingredients" USING btree ("name");
  CREATE INDEX "ingredients_status_idx" ON "ingredients" USING btree ("status");
  CREATE INDEX "ingredients_cas_number_idx" ON "ingredients" USING btree ("cas_number");
  CREATE INDEX "ingredients_ec_number_idx" ON "ingredients" USING btree ("ec_number");
  CREATE INDEX "ingredients_cos_ing_id_idx" ON "ingredients" USING btree ("cos_ing_id");
  CREATE INDEX "ingredients_updated_at_idx" ON "ingredients" USING btree ("updated_at");
  CREATE INDEX "ingredients_created_at_idx" ON "ingredients" USING btree ("created_at");
  CREATE INDEX "ingredients_discoveries_status_idx" ON "ingredients_discoveries" USING btree ("status");
  CREATE INDEX "ingredients_discoveries_updated_at_idx" ON "ingredients_discoveries" USING btree ("updated_at");
  CREATE INDEX "ingredients_discoveries_created_at_idx" ON "ingredients_discoveries" USING btree ("created_at");
  CREATE INDEX "products_ingredients_order_idx" ON "products_ingredients" USING btree ("_order");
  CREATE INDEX "products_ingredients_parent_id_idx" ON "products_ingredients" USING btree ("_parent_id");
  CREATE INDEX "products_ingredients_ingredient_idx" ON "products_ingredients" USING btree ("ingredient_id");
  CREATE INDEX "products_product_attributes_ingredient_names_order_idx" ON "products_product_attributes_ingredient_names" USING btree ("_order");
  CREATE INDEX "products_product_attributes_ingredient_names_parent_id_idx" ON "products_product_attributes_ingredient_names" USING btree ("_parent_id");
  CREATE INDEX "products_product_attributes_order_idx" ON "products_product_attributes" USING btree ("_order");
  CREATE INDEX "products_product_attributes_parent_id_idx" ON "products_product_attributes" USING btree ("_parent_id");
  CREATE INDEX "products_product_attributes_source_product_idx" ON "products_product_attributes" USING btree ("source_product_id");
  CREATE INDEX "products_product_claims_ingredient_names_order_idx" ON "products_product_claims_ingredient_names" USING btree ("_order");
  CREATE INDEX "products_product_claims_ingredient_names_parent_id_idx" ON "products_product_claims_ingredient_names" USING btree ("_parent_id");
  CREATE INDEX "products_product_claims_order_idx" ON "products_product_claims" USING btree ("_order");
  CREATE INDEX "products_product_claims_parent_id_idx" ON "products_product_claims" USING btree ("_parent_id");
  CREATE INDEX "products_product_claims_source_product_idx" ON "products_product_claims" USING btree ("source_product_id");
  CREATE UNIQUE INDEX "products_gtin_idx" ON "products" USING btree ("gtin");
  CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand_id");
  CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");
  CREATE INDEX "products_product_type_idx" ON "products" USING btree ("product_type_id");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "products_rels_order_idx" ON "products_rels" USING btree ("order");
  CREATE INDEX "products_rels_parent_idx" ON "products_rels" USING btree ("parent_id");
  CREATE INDEX "products_rels_path_idx" ON "products_rels" USING btree ("path");
  CREATE INDEX "products_rels_source_products_id_idx" ON "products_rels" USING btree ("source_products_id");
  CREATE INDEX "source_products_labels_order_idx" ON "source_products_labels" USING btree ("_order");
  CREATE INDEX "source_products_labels_parent_id_idx" ON "source_products_labels" USING btree ("_parent_id");
  CREATE INDEX "source_products_images_order_idx" ON "source_products_images" USING btree ("_order");
  CREATE INDEX "source_products_images_parent_id_idx" ON "source_products_images" USING btree ("_parent_id");
  CREATE INDEX "source_products_variants_options_order_idx" ON "source_products_variants_options" USING btree ("_order");
  CREATE INDEX "source_products_variants_options_parent_id_idx" ON "source_products_variants_options" USING btree ("_parent_id");
  CREATE INDEX "source_products_variants_order_idx" ON "source_products_variants" USING btree ("_order");
  CREATE INDEX "source_products_variants_parent_id_idx" ON "source_products_variants" USING btree ("_parent_id");
  CREATE INDEX "source_products_price_history_order_idx" ON "source_products_price_history" USING btree ("_order");
  CREATE INDEX "source_products_price_history_parent_id_idx" ON "source_products_price_history" USING btree ("_parent_id");
  CREATE INDEX "source_products_ingredients_order_idx" ON "source_products_ingredients" USING btree ("_order");
  CREATE INDEX "source_products_ingredients_parent_id_idx" ON "source_products_ingredients" USING btree ("_parent_id");
  CREATE INDEX "source_products_gtin_idx" ON "source_products" USING btree ("gtin");
  CREATE INDEX "source_products_status_idx" ON "source_products" USING btree ("status");
  CREATE INDEX "source_products_source_url_idx" ON "source_products" USING btree ("source_url");
  CREATE INDEX "source_products_source_idx" ON "source_products" USING btree ("source");
  CREATE INDEX "source_products_brand_name_idx" ON "source_products" USING btree ("brand_name");
  CREATE INDEX "source_products_source_category_idx" ON "source_products" USING btree ("source_category_id");
  CREATE INDEX "source_products_updated_at_idx" ON "source_products" USING btree ("updated_at");
  CREATE INDEX "source_products_created_at_idx" ON "source_products" USING btree ("created_at");
  CREATE INDEX "product_discoveries_status_idx" ON "product_discoveries" USING btree ("status");
  CREATE INDEX "product_discoveries_updated_at_idx" ON "product_discoveries" USING btree ("updated_at");
  CREATE INDEX "product_discoveries_created_at_idx" ON "product_discoveries" USING btree ("created_at");
  CREATE INDEX "product_crawls_status_idx" ON "product_crawls" USING btree ("status");
  CREATE INDEX "product_crawls_discovery_idx" ON "product_crawls" USING btree ("discovery_id");
  CREATE INDEX "product_crawls_updated_at_idx" ON "product_crawls" USING btree ("updated_at");
  CREATE INDEX "product_crawls_created_at_idx" ON "product_crawls" USING btree ("created_at");
  CREATE INDEX "product_aggregations_status_idx" ON "product_aggregations" USING btree ("status");
  CREATE INDEX "product_aggregations_product_idx" ON "product_aggregations" USING btree ("product_id");
  CREATE INDEX "product_aggregations_updated_at_idx" ON "product_aggregations" USING btree ("updated_at");
  CREATE INDEX "product_aggregations_created_at_idx" ON "product_aggregations" USING btree ("created_at");
  CREATE INDEX "crawl_results_crawl_idx" ON "crawl_results" USING btree ("crawl_id");
  CREATE INDEX "crawl_results_source_product_idx" ON "crawl_results" USING btree ("source_product_id");
  CREATE INDEX "crawl_results_updated_at_idx" ON "crawl_results" USING btree ("updated_at");
  CREATE INDEX "crawl_results_created_at_idx" ON "crawl_results" USING btree ("created_at");
  CREATE INDEX "discovery_results_discovery_idx" ON "discovery_results" USING btree ("discovery_id");
  CREATE INDEX "discovery_results_source_product_idx" ON "discovery_results" USING btree ("source_product_id");
  CREATE INDEX "discovery_results_updated_at_idx" ON "discovery_results" USING btree ("updated_at");
  CREATE INDEX "discovery_results_created_at_idx" ON "discovery_results" USING btree ("created_at");
  CREATE INDEX "category_discoveries_status_idx" ON "category_discoveries" USING btree ("status");
  CREATE INDEX "category_discoveries_updated_at_idx" ON "category_discoveries" USING btree ("updated_at");
  CREATE INDEX "category_discoveries_created_at_idx" ON "category_discoveries" USING btree ("created_at");
  CREATE INDEX "events_labels_order_idx" ON "events_labels" USING btree ("_order");
  CREATE INDEX "events_labels_parent_id_idx" ON "events_labels" USING btree ("_parent_id");
  CREATE INDEX "events_type_idx" ON "events" USING btree ("type");
  CREATE INDEX "events_level_idx" ON "events" USING btree ("level");
  CREATE INDEX "events_component_idx" ON "events" USING btree ("component");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE INDEX "events_rels_order_idx" ON "events_rels" USING btree ("order");
  CREATE INDEX "events_rels_parent_idx" ON "events_rels" USING btree ("parent_id");
  CREATE INDEX "events_rels_path_idx" ON "events_rels" USING btree ("path");
  CREATE INDEX "events_rels_product_discoveries_id_idx" ON "events_rels" USING btree ("product_discoveries_id");
  CREATE INDEX "events_rels_product_crawls_id_idx" ON "events_rels" USING btree ("product_crawls_id");
  CREATE INDEX "events_rels_ingredients_discoveries_id_idx" ON "events_rels" USING btree ("ingredients_discoveries_id");
  CREATE INDEX "events_rels_product_aggregations_id_idx" ON "events_rels" USING btree ("product_aggregations_id");
  CREATE INDEX "events_rels_video_discoveries_id_idx" ON "events_rels" USING btree ("video_discoveries_id");
  CREATE INDEX "events_rels_video_processings_id_idx" ON "events_rels" USING btree ("video_processings_id");
  CREATE INDEX "events_rels_category_discoveries_id_idx" ON "events_rels" USING btree ("category_discoveries_id");
  CREATE INDEX "creators_image_idx" ON "creators" USING btree ("image_id");
  CREATE INDEX "creators_updated_at_idx" ON "creators" USING btree ("updated_at");
  CREATE INDEX "creators_created_at_idx" ON "creators" USING btree ("created_at");
  CREATE INDEX "channels_creator_idx" ON "channels" USING btree ("creator_id");
  CREATE INDEX "channels_image_idx" ON "channels" USING btree ("image_id");
  CREATE INDEX "channels_updated_at_idx" ON "channels" USING btree ("updated_at");
  CREATE INDEX "channels_created_at_idx" ON "channels" USING btree ("created_at");
  CREATE INDEX "videos_channel_idx" ON "videos" USING btree ("channel_id");
  CREATE INDEX "videos_image_idx" ON "videos" USING btree ("image_id");
  CREATE INDEX "videos_processing_status_idx" ON "videos" USING btree ("processing_status");
  CREATE INDEX "videos_updated_at_idx" ON "videos" USING btree ("updated_at");
  CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");
  CREATE INDEX "video_snippets_screenshots_order_idx" ON "video_snippets_screenshots" USING btree ("_order");
  CREATE INDEX "video_snippets_screenshots_parent_id_idx" ON "video_snippets_screenshots" USING btree ("_parent_id");
  CREATE INDEX "video_snippets_screenshots_image_idx" ON "video_snippets_screenshots" USING btree ("image_id");
  CREATE INDEX "video_snippets_screenshots_thumbnail_idx" ON "video_snippets_screenshots" USING btree ("thumbnail_id");
  CREATE INDEX "video_snippets_screenshots_recognition_thumbnail_idx" ON "video_snippets_screenshots" USING btree ("recognition_thumbnail_id");
  CREATE INDEX "video_snippets_video_idx" ON "video_snippets" USING btree ("video_id");
  CREATE INDEX "video_snippets_image_idx" ON "video_snippets" USING btree ("image_id");
  CREATE INDEX "video_snippets_updated_at_idx" ON "video_snippets" USING btree ("updated_at");
  CREATE INDEX "video_snippets_created_at_idx" ON "video_snippets" USING btree ("created_at");
  CREATE INDEX "video_snippets_rels_order_idx" ON "video_snippets_rels" USING btree ("order");
  CREATE INDEX "video_snippets_rels_parent_idx" ON "video_snippets_rels" USING btree ("parent_id");
  CREATE INDEX "video_snippets_rels_path_idx" ON "video_snippets_rels" USING btree ("path");
  CREATE INDEX "video_snippets_rels_products_id_idx" ON "video_snippets_rels" USING btree ("products_id");
  CREATE INDEX "video_discoveries_status_idx" ON "video_discoveries" USING btree ("status");
  CREATE INDEX "video_discoveries_updated_at_idx" ON "video_discoveries" USING btree ("updated_at");
  CREATE INDEX "video_discoveries_created_at_idx" ON "video_discoveries" USING btree ("created_at");
  CREATE INDEX "video_processings_status_idx" ON "video_processings" USING btree ("status");
  CREATE INDEX "video_processings_video_idx" ON "video_processings" USING btree ("video_id");
  CREATE INDEX "video_processings_updated_at_idx" ON "video_processings" USING btree ("updated_at");
  CREATE INDEX "video_processings_created_at_idx" ON "video_processings" USING btree ("created_at");
  CREATE INDEX "workers_capabilities_order_idx" ON "workers_capabilities" USING btree ("order");
  CREATE INDEX "workers_capabilities_parent_idx" ON "workers_capabilities" USING btree ("parent_id");
  CREATE INDEX "workers_status_idx" ON "workers" USING btree ("status");
  CREATE INDEX "workers_updated_at_idx" ON "workers" USING btree ("updated_at");
  CREATE INDEX "workers_created_at_idx" ON "workers" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_brands_id_idx" ON "payload_locked_documents_rels" USING btree ("brands_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_product_types_id_idx" ON "payload_locked_documents_rels" USING btree ("product_types_id");
  CREATE INDEX "payload_locked_documents_rels_source_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("source_categories_id");
  CREATE INDEX "payload_locked_documents_rels_ingredients_id_idx" ON "payload_locked_documents_rels" USING btree ("ingredients_id");
  CREATE INDEX "payload_locked_documents_rels_ingredients_discoveries_id_idx" ON "payload_locked_documents_rels" USING btree ("ingredients_discoveries_id");
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_source_products_id_idx" ON "payload_locked_documents_rels" USING btree ("source_products_id");
  CREATE INDEX "payload_locked_documents_rels_product_discoveries_id_idx" ON "payload_locked_documents_rels" USING btree ("product_discoveries_id");
  CREATE INDEX "payload_locked_documents_rels_product_crawls_id_idx" ON "payload_locked_documents_rels" USING btree ("product_crawls_id");
  CREATE INDEX "payload_locked_documents_rels_product_aggregations_id_idx" ON "payload_locked_documents_rels" USING btree ("product_aggregations_id");
  CREATE INDEX "payload_locked_documents_rels_crawl_results_id_idx" ON "payload_locked_documents_rels" USING btree ("crawl_results_id");
  CREATE INDEX "payload_locked_documents_rels_discovery_results_id_idx" ON "payload_locked_documents_rels" USING btree ("discovery_results_id");
  CREATE INDEX "payload_locked_documents_rels_category_discoveries_id_idx" ON "payload_locked_documents_rels" USING btree ("category_discoveries_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_creators_id_idx" ON "payload_locked_documents_rels" USING btree ("creators_id");
  CREATE INDEX "payload_locked_documents_rels_channels_id_idx" ON "payload_locked_documents_rels" USING btree ("channels_id");
  CREATE INDEX "payload_locked_documents_rels_videos_id_idx" ON "payload_locked_documents_rels" USING btree ("videos_id");
  CREATE INDEX "payload_locked_documents_rels_video_snippets_id_idx" ON "payload_locked_documents_rels" USING btree ("video_snippets_id");
  CREATE INDEX "payload_locked_documents_rels_video_discoveries_id_idx" ON "payload_locked_documents_rels" USING btree ("video_discoveries_id");
  CREATE INDEX "payload_locked_documents_rels_video_processings_id_idx" ON "payload_locked_documents_rels" USING btree ("video_processings_id");
  CREATE INDEX "payload_locked_documents_rels_workers_id_idx" ON "payload_locked_documents_rels" USING btree ("workers_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_preferences_rels_workers_id_idx" ON "payload_preferences_rels" USING btree ("workers_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "brands" CASCADE;
  DROP TABLE "categories" CASCADE;
  DROP TABLE "product_types" CASCADE;
  DROP TABLE "source_categories" CASCADE;
  DROP TABLE "ingredients_functions" CASCADE;
  DROP TABLE "ingredients" CASCADE;
  DROP TABLE "ingredients_discoveries" CASCADE;
  DROP TABLE "products_ingredients" CASCADE;
  DROP TABLE "products_product_attributes_ingredient_names" CASCADE;
  DROP TABLE "products_product_attributes" CASCADE;
  DROP TABLE "products_product_claims_ingredient_names" CASCADE;
  DROP TABLE "products_product_claims" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "products_rels" CASCADE;
  DROP TABLE "source_products_labels" CASCADE;
  DROP TABLE "source_products_images" CASCADE;
  DROP TABLE "source_products_variants_options" CASCADE;
  DROP TABLE "source_products_variants" CASCADE;
  DROP TABLE "source_products_price_history" CASCADE;
  DROP TABLE "source_products_ingredients" CASCADE;
  DROP TABLE "source_products" CASCADE;
  DROP TABLE "product_discoveries" CASCADE;
  DROP TABLE "product_crawls" CASCADE;
  DROP TABLE "product_aggregations" CASCADE;
  DROP TABLE "crawl_results" CASCADE;
  DROP TABLE "discovery_results" CASCADE;
  DROP TABLE "category_discoveries" CASCADE;
  DROP TABLE "events_labels" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "events_rels" CASCADE;
  DROP TABLE "creators" CASCADE;
  DROP TABLE "channels" CASCADE;
  DROP TABLE "videos" CASCADE;
  DROP TABLE "video_snippets_screenshots" CASCADE;
  DROP TABLE "video_snippets" CASCADE;
  DROP TABLE "video_snippets_rels" CASCADE;
  DROP TABLE "video_discoveries" CASCADE;
  DROP TABLE "video_processings" CASCADE;
  DROP TABLE "workers_capabilities" CASCADE;
  DROP TABLE "workers" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_source_categories_source";
  DROP TYPE "public"."enum_ingredients_status";
  DROP TYPE "public"."enum_ingredients_item_type";
  DROP TYPE "public"."enum_ingredients_discoveries_status";
  DROP TYPE "public"."enum_products_product_attributes_attribute";
  DROP TYPE "public"."enum_products_product_attributes_evidence_type";
  DROP TYPE "public"."enum_products_product_claims_claim";
  DROP TYPE "public"."enum_products_product_claims_evidence_type";
  DROP TYPE "public"."enum_source_products_status";
  DROP TYPE "public"."enum_source_products_source";
  DROP TYPE "public"."enum_product_discoveries_status";
  DROP TYPE "public"."enum_product_crawls_status";
  DROP TYPE "public"."enum_product_crawls_source";
  DROP TYPE "public"."enum_product_crawls_type";
  DROP TYPE "public"."enum_product_crawls_scope";
  DROP TYPE "public"."enum_product_crawls_min_crawl_age_unit";
  DROP TYPE "public"."enum_product_aggregations_status";
  DROP TYPE "public"."enum_product_aggregations_type";
  DROP TYPE "public"."enum_product_aggregations_language";
  DROP TYPE "public"."enum_category_discoveries_status";
  DROP TYPE "public"."enum_events_type";
  DROP TYPE "public"."enum_events_level";
  DROP TYPE "public"."enum_events_component";
  DROP TYPE "public"."enum_channels_platform";
  DROP TYPE "public"."enum_videos_processing_status";
  DROP TYPE "public"."enum_video_snippets_matching_type";
  DROP TYPE "public"."enum_video_discoveries_status";
  DROP TYPE "public"."enum_video_processings_status";
  DROP TYPE "public"."enum_video_processings_type";
  DROP TYPE "public"."enum_workers_capabilities";
  DROP TYPE "public"."enum_workers_status";`)
}
