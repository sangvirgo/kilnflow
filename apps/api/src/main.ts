import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log('[kilnflow-api] listening on http://localhost:' + port + ' (CORS for ' + webOrigin + ')');
}
bootstrap();