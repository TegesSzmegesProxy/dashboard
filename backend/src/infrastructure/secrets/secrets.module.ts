import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from '../../config/environment.js';
import { LocalDevSecretStore } from './local-dev-secret-store.js';
import { SecretStore, UnconfiguredSecretStore } from './secret-store.js';
import { VaultSecretStore } from './vault-secret-store.js';

@Module({
  providers: [
    {
      provide: SecretStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>): SecretStore => {
        const kind = config.get('SECRET_STORE', { infer: true });
        if (kind === 'vault') {
          return new VaultSecretStore(
            config.get('VAULT_ADDR', { infer: true }),
            config.get('VAULT_TOKEN', { infer: true }),
            config.get('VAULT_KV_MOUNT', { infer: true }),
            config.get('VAULT_PATH_PREFIX', { infer: true }),
          );
        }
        if (kind === 'local-dev') {
          if (config.get('NODE_ENV', { infer: true }) === 'production') {
            throw new Error('SECRET_STORE=local-dev is refused in production');
          }
          return new LocalDevSecretStore(
            config.get('LOCAL_SECRET_STORE_FILE', { infer: true }),
            config.get('LOCAL_SECRET_STORE_KEY', { infer: true }),
          );
        }
        return new UnconfiguredSecretStore();
      },
    },
  ],
  exports: [SecretStore],
})
export class SecretsModule {}
