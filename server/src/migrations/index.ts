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
import * as migration_20260320_085223 from './20260320_085223';
import * as migration_20260320_141719 from './20260320_141719';
import * as migration_20260320_144245 from './20260320_144245';
import * as migration_20260320_164949 from './20260320_164949';
import * as migration_20260320_180704 from './20260320_180704';
import * as migration_20260320_193055 from './20260320_193055';
import * as migration_20260321_063656 from './20260321_063656';
import * as migration_20260321_171124 from './20260321_171124';
import * as migration_20260321_190652 from './20260321_190652';
import * as migration_20260322_084318 from './20260322_084318';
import * as migration_20260322_114814 from './20260322_114814';
import * as migration_20260322_125130 from './20260322_125130';
import * as migration_20260323_121552 from './20260323_121552';
import * as migration_20260323_200556 from './20260323_200556';
import * as migration_20260324_213443 from './20260324_213443';
import * as migration_20260327_155417 from './20260327_155417';
import * as migration_20260327_221105 from './20260327_221105';
import * as migration_20260329_132513 from './20260329_132513';
import * as migration_20260401_141143 from './20260401_141143';
import * as migration_20260401_155725 from './20260401_155725';
import * as migration_20260403_174250 from './20260403_174250';
import * as migration_20260403_174443 from './20260403_174443';
import * as migration_20260403_201314 from './20260403_201314';
import * as migration_20260403_202743 from './20260403_202743';
import * as migration_20260403_204628 from './20260403_204628';
import * as migration_20260405_072717 from './20260405_072717';

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
    name: '20260319_210655',
  },
  {
    up: migration_20260320_085223.up,
    down: migration_20260320_085223.down,
    name: '20260320_085223',
  },
  {
    up: migration_20260320_141719.up,
    down: migration_20260320_141719.down,
    name: '20260320_141719',
  },
  {
    up: migration_20260320_144245.up,
    down: migration_20260320_144245.down,
    name: '20260320_144245',
  },
  {
    up: migration_20260320_164949.up,
    down: migration_20260320_164949.down,
    name: '20260320_164949',
  },
  {
    up: migration_20260320_180704.up,
    down: migration_20260320_180704.down,
    name: '20260320_180704',
  },
  {
    up: migration_20260320_193055.up,
    down: migration_20260320_193055.down,
    name: '20260320_193055',
  },
  {
    up: migration_20260321_063656.up,
    down: migration_20260321_063656.down,
    name: '20260321_063656',
  },
  {
    up: migration_20260321_171124.up,
    down: migration_20260321_171124.down,
    name: '20260321_171124',
  },
  {
    up: migration_20260321_190652.up,
    down: migration_20260321_190652.down,
    name: '20260321_190652',
  },
  {
    up: migration_20260322_084318.up,
    down: migration_20260322_084318.down,
    name: '20260322_084318',
  },
  {
    up: migration_20260322_114814.up,
    down: migration_20260322_114814.down,
    name: '20260322_114814',
  },
  {
    up: migration_20260322_125130.up,
    down: migration_20260322_125130.down,
    name: '20260322_125130',
  },
  {
    up: migration_20260323_121552.up,
    down: migration_20260323_121552.down,
    name: '20260323_121552',
  },
  {
    up: migration_20260323_200556.up,
    down: migration_20260323_200556.down,
    name: '20260323_200556',
  },
  {
    up: migration_20260324_213443.up,
    down: migration_20260324_213443.down,
    name: '20260324_213443',
  },
  {
    up: migration_20260327_155417.up,
    down: migration_20260327_155417.down,
    name: '20260327_155417',
  },
  {
    up: migration_20260327_221105.up,
    down: migration_20260327_221105.down,
    name: '20260327_221105',
  },
  {
    up: migration_20260329_132513.up,
    down: migration_20260329_132513.down,
    name: '20260329_132513',
  },
  {
    up: migration_20260401_141143.up,
    down: migration_20260401_141143.down,
    name: '20260401_141143',
  },
  {
    up: migration_20260401_155725.up,
    down: migration_20260401_155725.down,
    name: '20260401_155725',
  },
  {
    up: migration_20260403_174250.up,
    down: migration_20260403_174250.down,
    name: '20260403_174250',
  },
  {
    up: migration_20260403_174443.up,
    down: migration_20260403_174443.down,
    name: '20260403_174443',
  },
  {
    up: migration_20260403_201314.up,
    down: migration_20260403_201314.down,
    name: '20260403_201314',
  },
  {
    up: migration_20260403_202743.up,
    down: migration_20260403_202743.down,
    name: '20260403_202743',
  },
  {
    up: migration_20260403_204628.up,
    down: migration_20260403_204628.down,
    name: '20260403_204628',
  },
  {
    up: migration_20260405_072717.up,
    down: migration_20260405_072717.down,
    name: '20260405_072717'
  },
];
