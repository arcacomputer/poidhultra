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
import {
  verifyObject,
  verifyReferences,
} from "../../packages/storage/src/portable";
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
  for (const prefix of ["sha256/", "remote/v1/"]) {
    let cursor: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: prefix,
          ContinuationToken: cursor,
        })
      );
      for (const item of page.Contents ?? []) {
        if (!item.Key) throw new Error("Missing storage key");
        const object = await client.send(
          new GetObjectCommand({ Bucket, Key: item.Key })
        );
        const bytes = await object.Body!.transformToByteArray();
        const sha256 = await verifyObject(item.Key, bytes);
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
  }
  const keys = new Set(objects.map((item) => item.key));
  for (const item of objects)
    if (/^remote\/v1\/(sources|manifests)\//.test(item.key))
      verifyReferences(
        item.key,
        await readFile(resolve(dir, item.sha256)),
        keys
      );
  await writeFile(
    resolve(dir, "manifest.json"),
    JSON.stringify(
      { version: 2, exportedAt: new Date().toISOString(), objects },
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
  if (![1, 2].includes(manifest.version) || !Array.isArray(manifest.objects))
    throw new Error("Invalid manifest");
  for (const item of manifest.objects) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.key !== "string")
      throw new Error("Invalid content key");
    const bytes = await readFile(resolve(dir, item.sha256));
    if (hash(bytes) !== item.sha256 || bytes.length !== item.size)
      throw new Error("Corrupt export");
    await verifyObject(item.key, bytes);
    verifyReferences(
      item.key,
      bytes,
      new Set(manifest.objects.map((object: any) => object.key))
    );
  }
  // Validate the complete export before writing; publish mutable pointers last.
  manifest.objects.sort(
    (a: any, b: any) =>
      Number(a.key.startsWith("remote/v1/sources/")) -
      Number(b.key.startsWith("remote/v1/sources/"))
  );
  for (const item of manifest.objects) {
    const bytes = await readFile(resolve(dir, item.sha256));
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
  console.log(
    `Restored ${manifest.objects.length} verified objects and source mappings`
  );
} else
  throw new Error(
    "Usage: portable.ts init | export <directory> | import <directory>"
  );
