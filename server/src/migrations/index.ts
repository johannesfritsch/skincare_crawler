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
import * as migration_20260317_153336 from './20260317_153336';
import * as migration_20260317_181255 from './20260317_181255';
import * as migration_20260318_002552 from './20260318_002552';
import * as migration_20260318_094324 from './20260318_094324';
import * as migration_20260318_103424 from './20260318_103424';
import * as migration_20260318_120000_recognition_embeddings_table from './20260318_120000_recognition_embeddings_table';
import * as migration_20260318_153916 from './20260318_153916';
import * as migration_20260318_183127 from './20260318_183127';
import * as migration_20260318_210630 from './20260318_210630';
import * as migration_20260319_084209 from './20260319_084209';
import * as migration_20260319_121439 from './20260319_121439';
import * as migration_20260319_161713 from './20260319_161713';
import * as migration_20260319_172548 from './20260319_172548';
import * as migration_20260319_210655 from './20260319_210655';

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
    name: '20260316_213914',
  },
  {
    up: migration_20260317_153336.up,
    down: migration_20260317_153336.down,
    name: '20260317_153336',
  },
  {
    up: migration_20260317_181255.up,
    down: migration_20260317_181255.down,
    name: '20260317_181255',
  },
  {
    up: migration_20260318_002552.up,
    down: migration_20260318_002552.down,
    name: '20260318_002552',
  },
  {
    up: migration_20260318_094324.up,
    down: migration_20260318_094324.down,
    name: '20260318_094324',
  },
  {
    up: migration_20260318_103424.up,
    down: migration_20260318_103424.down,
    name: '20260318_103424',
  },
  {
    up: migration_20260318_120000_recognition_embeddings_table.up,
    down: migration_20260318_120000_recognition_embeddings_table.down,
    name: '20260318_120000_recognition_embeddings_table',
  },
  {
    up: migration_20260318_153916.up,
    down: migration_20260318_153916.down,
    name: '20260318_153916',
  },
  {
    up: migration_20260318_183127.up,
    down: migration_20260318_183127.down,
    name: '20260318_183127',
  },
  {
    up: migration_20260318_210630.up,
    down: migration_20260318_210630.down,
    name: '20260318_210630',
  },
  {
    up: migration_20260319_084209.up,
    down: migration_20260319_084209.down,
    name: '20260319_084209',
  },
  {
    up: migration_20260319_121439.up,
    down: migration_20260319_121439.down,
    name: '20260319_121439',
  },
  {
    up: migration_20260319_161713.up,
    down: migration_20260319_161713.down,
    name: '20260319_161713',
  },
  {
    up: migration_20260319_172548.up,
    down: migration_20260319_172548.down,
    name: '20260319_172548',
  },
  {
    up: migration_20260319_210655.up,
    down: migration_20260319_210655.down,
    name: '20260319_210655'
  },
];
