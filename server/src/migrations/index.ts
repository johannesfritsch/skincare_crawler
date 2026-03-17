import * as migration_20260314_001555 from './20260314_001555';
import * as migration_20260314_001712_add_vectors_to_recognition_images from './20260314_001712_add_vectors_to_recognition_images';
import * as migration_20260314_005052_add_more_config_to_video_processings from './20260314_005052_add_more_config_to_video_processings';
import * as migration_20260314_134030 from './20260314_134030';
import * as migration_20260314_155003_new_videos_structure from './20260314_155003_new_videos_structure';
import * as migration_20260314_162248 from './20260314_162248';
import * as migration_20260314_183349 from './20260314_183349';
import * as migration_20260314_203348 from './20260314_203348';
import * as migration_20260314_224316_separate_change_fields from './20260314_224316_separate_change_fields';
import * as migration_20260315_143016 from './20260315_143016';
import * as migration_20260315_163725 from './20260315_163725';
import * as migration_20260315_233008 from './20260315_233008';
import * as migration_20260316_123305 from './20260316_123305';
import * as migration_20260316_180316 from './20260316_180316';
import * as migration_20260316_183827 from './20260316_183827';
import * as migration_20260316_195915 from './20260316_195915';
import * as migration_20260316_213914 from './20260316_213914';

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
    name: '20260314_134030',
  },
  {
    up: migration_20260314_155003_new_videos_structure.up,
    down: migration_20260314_155003_new_videos_structure.down,
    name: '20260314_155003_new_videos_structure',
  },
  {
    up: migration_20260314_162248.up,
    down: migration_20260314_162248.down,
    name: '20260314_162248',
  },
  {
    up: migration_20260314_183349.up,
    down: migration_20260314_183349.down,
    name: '20260314_183349',
  },
  {
    up: migration_20260314_203348.up,
    down: migration_20260314_203348.down,
    name: '20260314_203348',
  },
  {
    up: migration_20260314_224316_separate_change_fields.up,
    down: migration_20260314_224316_separate_change_fields.down,
    name: '20260314_224316_separate_change_fields',
  },
  {
    up: migration_20260315_143016.up,
    down: migration_20260315_143016.down,
    name: '20260315_143016',
  },
  {
    up: migration_20260315_163725.up,
    down: migration_20260315_163725.down,
    name: '20260315_163725',
  },
  {
    up: migration_20260315_233008.up,
    down: migration_20260315_233008.down,
    name: '20260315_233008',
  },
  {
    up: migration_20260316_123305.up,
    down: migration_20260316_123305.down,
    name: '20260316_123305',
  },
  {
    up: migration_20260316_180316.up,
    down: migration_20260316_180316.down,
    name: '20260316_180316',
  },
  {
    up: migration_20260316_183827.up,
    down: migration_20260316_183827.down,
    name: '20260316_183827',
  },
  {
    up: migration_20260316_195915.up,
    down: migration_20260316_195915.down,
    name: '20260316_195915',
  },
  {
    up: migration_20260316_213914.up,
    down: migration_20260316_213914.down,
    name: '20260316_213914'
  },
];
