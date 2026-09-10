import { digest, sourceKey } from "./mirror";

export async function verifyObject(key: string, bytes: Uint8Array) {
  if (
    !/^(sha256\/|remote\/v1\/(images|metadata|manifests|sources)\/)[a-f0-9]{64}$/.test(
      key
    )
  )
    throw new Error("Invalid storage key");
  const sha256 = await digest(bytes);
  if (key.startsWith("remote/v1/sources/")) {
    const capture = JSON.parse(new TextDecoder().decode(bytes));
    if (
      capture.version !== 1 ||
      typeof capture.source !== "string" ||
      !/^[a-f0-9]{64}$/.test(capture.sha256) ||
      !Number.isFinite(Date.parse(capture.capturedAt)) ||
      ![
        await sourceKey(capture.source, true),
        await sourceKey(capture.source, false),
      ].includes(key)
    )
      throw new Error("Invalid media source manifest");
  } else if (!key.endsWith("/" + sha256))
    throw new Error("Content digest mismatch");
  return sha256;
}

export function verifyReferences(
  key: string,
  bytes: Uint8Array,
  keys: Set<string>
) {
  if (!/^remote\/v1\/(sources|manifests)\//.test(key)) return;
  const capture = JSON.parse(new TextDecoder().decode(bytes));
  if (
    !keys.has("remote/v1/images/" + capture.sha256) ||
    (capture.metadataSha256 &&
      !keys.has("remote/v1/metadata/" + capture.metadataSha256))
  )
    throw new Error(
      "Media export has a missing referenced object; retry the export"
    );
}
