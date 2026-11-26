import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  process.env.SG_PROCESS_STARTED_AT_MS ??= String(Date.now());
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

  const corsOrigins = (process.env.CORS_ORIGINS ?? "https://sentinelgrid-delta.vercel.app,http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

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
