import * as migration_20260313_051511_initial from './20260313_051511_initial';
import * as migration_20260313_055754_add_embed_images_stage from './20260313_055754_add_embed_images_stage';
import * as migration_20260313_055830_add_vectors_to_recognition_images from './20260313_055830_add_vectors_to_recognition_images';
import * as migration_20260313_085035 from './20260313_085035';
import * as migration_20260313_091615 from './20260313_091615';
import * as migration_20260313_110500_video_crawl_pipeline from './20260313_110500_video_crawl_pipeline';
import * as migration_20260313_170000_add_detection_threshold from './20260313_170000_add_detection_threshold';
import * as migration_20260313_180000_split_media_collections from './20260313_180000_split_media_collections';

export const migrations = [
  {
    up: migration_20260313_051511_initial.up,
    down: migration_20260313_051511_initial.down,
    name: '20260313_051511_initial',
  },
  {
    up: migration_20260313_055754_add_embed_images_stage.up,
    down: migration_20260313_055754_add_embed_images_stage.down,
    name: '20260313_055754_add_embed_images_stage',
  },
  {
    up: migration_20260313_055830_add_vectors_to_recognition_images.up,
    down: migration_20260313_055830_add_vectors_to_recognition_images.down,
    name: '20260313_055830_add_vectors_to_recognition_images',
  },
  {
    up: migration_20260313_085035.up,
    down: migration_20260313_085035.down,
    name: '20260313_085035',
  },
  {
    up: migration_20260313_091615.up,
    down: migration_20260313_091615.down,
    name: '20260313_091615',
  },
  {
    up: migration_20260313_110500_video_crawl_pipeline.up,
    down: migration_20260313_110500_video_crawl_pipeline.down,
    name: '20260313_110500_video_crawl_pipeline',
  },
  {
    up: migration_20260313_170000_add_detection_threshold.up,
    down: migration_20260313_170000_add_detection_threshold.down,
    name: '20260313_170000_add_detection_threshold',
  },
  {
    up: migration_20260313_180000_split_media_collections.up,
    down: migration_20260313_180000_split_media_collections.down,
    name: '20260313_180000_split_media_collections',
  },
];
