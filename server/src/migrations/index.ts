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
import * as migration_20260407_221822 from './20260407_221822';
import * as migration_20260410_213908 from './20260410_213908';
import * as migration_20260412_035335 from './20260412_035335';
import * as migration_20260412_062537 from './20260412_062537';
import * as migration_20260412_075923 from './20260412_075923';
import * as migration_20260412_094812 from './20260412_094812';
import * as migration_20260415_204008 from './20260415_204008';
import * as migration_20260416_064514 from './20260416_064514';
import * as migration_20260416_174744 from './20260416_174744';
import * as migration_20260416_212646 from './20260416_212646';
import * as migration_20260416_220322 from './20260416_220322';
import * as migration_20260416_223906 from './20260416_223906';
import * as migration_20260417_094732 from './20260417_094732';
import * as migration_20260417_122310 from './20260417_122310';
import * as migration_20260417_145122 from './20260417_145122';
import * as migration_20260419_144921 from './20260419_144921';
import * as migration_20260419_184903 from './20260419_184903';
import * as migration_20260421_080010 from './20260421_080010';
import * as migration_20260421_082257 from './20260421_082257';
import * as migration_20260421_084707 from './20260421_084707';
import * as migration_20260421_110944 from './20260421_110944';

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
    name: '20260405_072717',
  },
  {
    up: migration_20260407_221822.up,
    down: migration_20260407_221822.down,
    name: '20260407_221822',
  },
  {
    up: migration_20260410_213908.up,
    down: migration_20260410_213908.down,
    name: '20260410_213908',
  },
  {
    up: migration_20260412_035335.up,
    down: migration_20260412_035335.down,
    name: '20260412_035335',
  },
  {
    up: migration_20260412_062537.up,
    down: migration_20260412_062537.down,
    name: '20260412_062537',
  },
  {
    up: migration_20260412_075923.up,
    down: migration_20260412_075923.down,
    name: '20260412_075923',
  },
  {
    up: migration_20260412_094812.up,
    down: migration_20260412_094812.down,
    name: '20260412_094812',
  },
  {
    up: migration_20260415_204008.up,
    down: migration_20260415_204008.down,
    name: '20260415_204008',
  },
  {
    up: migration_20260416_064514.up,
    down: migration_20260416_064514.down,
    name: '20260416_064514',
  },
  {
    up: migration_20260416_174744.up,
    down: migration_20260416_174744.down,
    name: '20260416_174744',
  },
  {
    up: migration_20260416_212646.up,
    down: migration_20260416_212646.down,
    name: '20260416_212646',
  },
  {
    up: migration_20260416_220322.up,
    down: migration_20260416_220322.down,
    name: '20260416_220322',
  },
  {
    up: migration_20260416_223906.up,
    down: migration_20260416_223906.down,
    name: '20260416_223906',
  },
  {
    up: migration_20260417_094732.up,
    down: migration_20260417_094732.down,
    name: '20260417_094732',
  },
  {
    up: migration_20260417_122310.up,
    down: migration_20260417_122310.down,
    name: '20260417_122310',
  },
  {
    up: migration_20260417_145122.up,
    down: migration_20260417_145122.down,
    name: '20260417_145122',
  },
  {
    up: migration_20260419_144921.up,
    down: migration_20260419_144921.down,
    name: '20260419_144921',
  },
  {
    up: migration_20260419_184903.up,
    down: migration_20260419_184903.down,
    name: '20260419_184903',
  },
  {
    up: migration_20260421_080010.up,
    down: migration_20260421_080010.down,
    name: '20260421_080010',
  },
  {
    up: migration_20260421_082257.up,
    down: migration_20260421_082257.down,
    name: '20260421_082257',
  },
  {
    up: migration_20260421_084707.up,
    down: migration_20260421_084707.down,
    name: '20260421_084707',
  },
  {
    up: migration_20260421_110944.up,
    down: migration_20260421_110944.down,
    name: '20260421_110944'
  },
];
