import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { correlationIdMiddleware } from './common/http/correlation';
import type { AppEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<AppEnv>('APP_ENV');
  const logger = new Logger('Bootstrap');

  app.use(correlationIdMiddleware);
  app.setGlobalPrefix('api', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Hachi Hashi — Menu/Catalog')
    .setDescription('API del menú del restaurante: platillos, categorías, precios, alérgenos y fotos.')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  await app.listen(env.PORT);

  logger.log(`Menu/Catalog escuchando en http://localhost:${env.PORT}`);
  logger.log(`Swagger disponible en http://localhost:${env.PORT}/api/docs`);
  logger.log(`Modo: ${env.APP_MODE} · auth: ${env.AUTH_MODE} · seed: ${env.SEED_ON_START}`);
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.stack : String(error), undefined, 'Bootstrap');
  process.exit(1);
});
