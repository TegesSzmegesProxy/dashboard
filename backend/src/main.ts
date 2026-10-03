import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { Environment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Environment, true>);
  const apiPrefix = config.get('API_PREFIX', { infer: true });

  app.use(
    helmet({
      contentSecurityPolicy: {
        // TLS is terminated in front of the API, where HSTS enforces HTTPS.
        // Upgrading subresources breaks Swagger UI on plain-HTTP localhost.
        directives: { upgradeInsecureRequests: null },
      },
    }),
  );
  // Collector environment packages can list thousands of dependencies.
  app.useBodyParser('json', { limit: '5mb' });
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(','),
    credentials: true,
  });
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Tessera Control Plane API')
      .setDescription('Hosted control-plane API for Tessera')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
