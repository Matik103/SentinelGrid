import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export type ObjectStoreBackend = "local_dev" | "s3_compatible";

export type ObjectStore = {
  readonly backend: ObjectStoreBackend;
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
};

export class LocalDevObjectStore implements ObjectStore {
  readonly backend = "local_dev" as const;

  constructor(private readonly root: string) {}

  private resolve(objectKey: string): string {
    if (objectKey.includes("..") || path.isAbsolute(objectKey)) {
      throw new Error("Invalid object key");
    }
    const full = path.resolve(this.root, objectKey);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid object key");
    return full;
  }

  async put(objectKey: string, bytes: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(objectKey);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, bytes, { flag: "wx", mode: 0o600 });
  }

  async get(objectKey: string): Promise<Buffer> {
    return readFile(this.resolve(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.resolve(objectKey), { force: true });
  }
}

export type S3ObjectStoreConfig = {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
};

export class S3ObjectStore implements ObjectStore {
  readonly backend = "s3_compatible" as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3ObjectStoreConfig) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? Boolean(cfg.endpoint),
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    });
  }

  async put(objectKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
      }),
    );
  }

  async get(objectKey: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: objectKey }),
    );
    if (!out.Body) throw new Error("S3 GetObject returned empty body");
    return streamToBuffer(out.Body as Readable);
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: objectKey }),
    );
  }
}

async function streamToBuffer(body: Readable | Uint8Array | string | Blob): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (typeof (body as Readable).pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // Browser Blob in some SDK typings
  if (typeof (body as Blob).arrayBuffer === "function") {
    return Buffer.from(await (body as Blob).arrayBuffer());
  }
  throw new Error("Unsupported S3 body type");
}

/**
 * Resolve object store from environment. Fail-closed when misconfigured.
 * - local_dev forbidden when NODE_ENV=production
 * - s3 / s3_compatible requires bucket + region; credentials or default provider chain
 */
export function createObjectStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObjectStore {
  const requested = (env.PAYLOAD_STORAGE_BACKEND ?? "local_dev").trim().toLowerCase();
  const nodeEnv = env.NODE_ENV ?? "development";

  if (requested === "local_dev") {
    if (nodeEnv === "production") {
      throw new Error("local_dev payload storage is forbidden in production");
    }
    const root = path.resolve(env.PAYLOAD_STORAGE_ROOT ?? path.join(process.cwd(), ".payload-store"));
    return new LocalDevObjectStore(root);
  }

  if (requested === "s3" || requested === "s3_compatible") {
    const bucket = env.S3_BUCKET?.trim() || env.PAYLOAD_S3_BUCKET?.trim();
    const region = env.AWS_REGION?.trim() || env.S3_REGION?.trim();
    const endpoint = env.S3_ENDPOINT?.trim() || undefined;
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim() || undefined;
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim() || undefined;

    if (!bucket || !region) {
      throw new Error(
        "S3 payload storage misconfigured: S3_BUCKET (or PAYLOAD_S3_BUCKET) and AWS_REGION (or S3_REGION) are required",
      );
    }
    // Explicit keys must be paired; otherwise rely on default provider chain (IAM role, etc.).
    if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
      throw new Error(
        "S3 payload storage misconfigured: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set or both omitted",
      );
    }
    if (nodeEnv === "production" && endpoint && !/^https:\/\//i.test(endpoint)) {
      throw new Error("S3_ENDPOINT must use https in production");
    }

    return new S3ObjectStore({
      region,
      bucket,
      endpoint,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "1" || env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId,
      secretAccessKey,
    });
  }

  throw new Error(
    `Unsupported PAYLOAD_STORAGE_BACKEND: ${requested}; refusing metadata-only evidence writes`,
  );
}
