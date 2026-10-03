import { Module } from '@nestjs/common';
import { CredentialCipher } from './credential-cipher.service.js';

@Module({
  providers: [CredentialCipher],
  exports: [CredentialCipher],
})
export class SecretsModule {}
