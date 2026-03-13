import * as migration_20260313_051511_initial from './20260313_051511_initial';
import * as migration_20260313_055754_add_embed_images_stage from './20260313_055754_add_embed_images_stage';
import * as migration_20260313_055830_add_vectors_to_recognition_images from './20260313_055830_add_vectors_to_recognition_images';

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
    name: '20260313_055830_add_vectors_to_recognition_images'
  },
];
