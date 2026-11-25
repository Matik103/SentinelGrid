import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
    bodyParser: false,
  });
  app.use(json({ limit: process.env.JSON_BODY_LIMIT ?? "1mb" }));
  app.use(
    urlencoded({
      extended: false,
      limit: process.env.FORM_BODY_LIMIT ?? "64kb",
    }),
  );
  app.setGlobalPrefix("v1");

  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  await app.listen(port, "0.0.0.0");
  console.log(`SentinelGrid API listening on :${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error("SentinelGrid API failed to start", error);
  process.exitCode = 1;
});
