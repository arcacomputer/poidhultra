import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "../../packages/storage/node_modules/@aws-sdk/client-s3/dist-es/index.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});
const Bucket = process.env.S3_BUCKET;
if (!Bucket) throw new Error("Set S3_BUCKET and S3 credentials");
const command = process.argv[2];
const dir = resolve(process.argv[3] ?? ".");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
if (command === "init") {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
      break;
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        await client.send(new CreateBucketCommand({ Bucket }));
        break;
      }
      if (attempt >= 20) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log("Storage bucket ready");
} else if (command === "export") {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const objects: { key: string; sha256: string; type: string; size: number }[] =
    [];
  let cursor: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket,
        Prefix: "sha256/",
        ContinuationToken: cursor,
      })
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key?.match(/^sha256\/[a-f0-9]{64}$/))
        throw new Error("Unexpected content key");
      const object = await client.send(
        new GetObjectCommand({ Bucket, Key: item.Key })
      );
      const bytes = await object.Body!.transformToByteArray();
      const sha256 = hash(bytes);
      if (item.Key !== "sha256/" + sha256)
        throw new Error("Content digest mismatch");
      await writeFile(resolve(dir, sha256), bytes, { mode: 0o600 });
      objects.push({
        key: item.Key,
        sha256,
        type: object.ContentType ?? "application/octet-stream",
        size: bytes.length,
      });
    }
    if (page.IsTruncated && !page.NextContinuationToken)
      throw new Error("Storage pagination stopped early");
    cursor = page.NextContinuationToken;
  } while (cursor);
  await writeFile(
    resolve(dir, "manifest.json"),
    JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), objects },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  );
  console.log(`Exported and verified ${objects.length} objects`);
} else if (command === "import") {
  const manifest = JSON.parse(
    await readFile(resolve(dir, "manifest.json"), "utf8")
  );
  if (manifest.version !== 1 || !Array.isArray(manifest.objects))
    throw new Error("Invalid manifest");
  for (const item of manifest.objects) {
    if (
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      item.key !== "sha256/" + item.sha256
    )
      throw new Error("Invalid content key");
    const bytes = await readFile(resolve(dir, item.sha256));
    if (hash(bytes) !== item.sha256 || bytes.length !== item.size)
      throw new Error("Corrupt export");
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: item.key,
        Body: bytes,
        ContentType: item.type,
        CacheControl: "public,max-age=31536000,immutable",
      })
    );
  }
  console.log(`Restored ${manifest.objects.length} verified immutable objects`);
} else
  throw new Error(
    "Usage: portable.ts init | export <directory> | import <directory>"
  );
