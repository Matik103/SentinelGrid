import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.setGlobalPrefix("v1");
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SentinelGrid API listening on :${port}`);
}

bootstrap();
