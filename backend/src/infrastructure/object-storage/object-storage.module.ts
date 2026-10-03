import { Module } from '@nestjs/common';
import { LocalFileObjectStorage } from './local-file-object-storage.js';
import { ObjectStorage } from './object-storage.js';

@Module({
  providers: [{ provide: ObjectStorage, useClass: LocalFileObjectStorage }],
  exports: [ObjectStorage],
})
export class ObjectStorageModule {}
