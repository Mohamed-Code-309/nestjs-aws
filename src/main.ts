import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { join } from 'path';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Serve static/HTML files
  app.use('/', express.static(join(__dirname, '..', 'views')));

  await app.listen(4000);
}
bootstrap();
