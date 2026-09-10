import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { ObjectStore } from "./objects";
export * from "./objects";
export function s3(options: {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}): ObjectStore {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region ?? "us-east-1",
    forcePathStyle: !!options.endpoint,
    ...(options.accessKeyId && options.secretAccessKey
      ? {
          credentials: {
            accessKeyId: options.accessKeyId,
            secretAccessKey: options.secretAccessKey,
          },
        }
      : {}),
  });
  return {
    put: async (key, body, type) => {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: type,
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    },
    get: async (key) => {
      try {
        const value = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key })
        );
        return value.Body
          ? {
              body: value.Body.transformToWebStream(),
              type: value.ContentType ?? "application/octet-stream",
            }
          : null;
      } catch (error: any) {
        if (error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
  };
}
