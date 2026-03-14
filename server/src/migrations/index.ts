import * as migration_20260314_001555 from './20260314_001555';
import * as migration_20260314_001712_add_vectors_to_recognition_images from './20260314_001712_add_vectors_to_recognition_images';
import * as migration_20260314_005052_add_more_config_to_video_processings from './20260314_005052_add_more_config_to_video_processings';
import * as migration_20260314_134030 from './20260314_134030';

export const migrations = [
  {
    up: migration_20260314_001555.up,
    down: migration_20260314_001555.down,
    name: '20260314_001555',
  },
  {
    up: migration_20260314_001712_add_vectors_to_recognition_images.up,
    down: migration_20260314_001712_add_vectors_to_recognition_images.down,
    name: '20260314_001712_add_vectors_to_recognition_images',
  },
  {
    up: migration_20260314_005052_add_more_config_to_video_processings.up,
    down: migration_20260314_005052_add_more_config_to_video_processings.down,
    name: '20260314_005052_add_more_config_to_video_processings',
  },
  {
    up: migration_20260314_134030.up,
    down: migration_20260314_134030.down,
    name: '20260314_134030'
  },
];
