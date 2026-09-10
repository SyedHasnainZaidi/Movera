import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(AppConfigService);

  app.useLogger(
    config.isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  );

  // Only when something in front genuinely sets X-Forwarded-For. Without it,
  // every visitor behind a proxy shares one rate-limit bucket; with it wrongly
  // enabled on a directly-exposed server, the header can be forged.
  if (config.trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    Logger.log('Trusting X-Forwarded-For (TRUST_PROXY=true)', 'Bootstrap');
  }

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());

  // Explicit origin allowlist. Never `*` - the superseded FastAPI prototype
  // combined `allow_origins=["*"]` with `allow_credentials=True`, which is both
  // insecure and rejected by browsers.
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // and reject requests that sent them
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const prisma = app.get(PrismaService);
  prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  const swagger = new DocumentBuilder()
    .setTitle('Movera API')
    .setDescription(
      'Application backend for Movera - the AI-Powered Intelligent ' +
        'Physiotherapy Assessment and Rehabilitation Monitoring System.\n\n' +
        '**Clinical disclaimer.** This is an academic rehabilitation *support* ' +
        'prototype. It does not diagnose, and its pose thresholds are ' +
        'unvalidated defaults requiring physiotherapist review.\n\n' +
        'Endpoints under `/internal` are the pose-service channel. They are ' +
        'authenticated by a shared secret, not by user credentials, and are ' +
        'not callable from a browser.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addTag('Authentication')
    .addTag('Health')
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.port);

  const logger = new Logger('Bootstrap');
  logger.log(`Environment      : ${config.nodeEnv}`);
  logger.log(`API              : http://localhost:${config.port}/api/v1`);
  logger.log(`Swagger          : http://localhost:${config.port}/api/docs`);
  logger.log(`Allowed origins  : ${config.corsOrigins.join(', ')}`);
}

void bootstrap();
