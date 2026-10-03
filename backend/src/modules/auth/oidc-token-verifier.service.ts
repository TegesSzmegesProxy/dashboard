import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  JWTVerifyGetKey,
  JWTPayload,
} from 'jose';
import { Environment } from '../../config/environment.js';

@Injectable()
export class OidcTokenVerifier {
  private readonly audience: string;
  private readonly issuer: string;
  private readonly jwks: JWTVerifyGetKey;

  constructor(config: ConfigService<Environment, true>) {
    const configuredIssuer = config.get('AUTH0_ISSUER_URL', { infer: true });
    this.issuer = configuredIssuer.endsWith('/')
      ? configuredIssuer
      : `${configuredIssuer}/`;
    this.audience = config.get('AUTH0_AUDIENCE', { infer: true });
    this.jwks = createRemoteJWKSet(
      new URL('.well-known/jwks.json', this.issuer),
    );
  }

  async verify(token: string): Promise<JWTPayload & { sub: string }> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ['RS256'],
        audience: this.audience,
        issuer: this.issuer,
      });
      if (!payload.sub) {
        throw new UnauthorizedException('Access token has no subject');
      }
      return payload as JWTPayload & { sub: string };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
