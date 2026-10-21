import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ProblemDetailsFilter } from '../../../src/common/http/problem-details.filter';
import { correlationIdMiddleware } from '../../../src/common/http/correlation';

export interface TestAppOptions {
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Crea la aplicación Nest para pruebas sin abrir un puerto. Supertest usa el
 * servidor HTTP subyacente. Las migraciones y las variables de entorno deben
 * estar listas antes de llamar a esta función.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const { AppModule } = await import('../../../src/app.module');
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.configure) {
    builder = options.configure(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });

  app.use(correlationIdMiddleware);
  app.setGlobalPrefix('api', { exclude: ['health', 'metrics'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  await app.init();
  return app;
}
