import { cardMedia } from "./media-source";
import { MediaMirror } from "./mirror";

/** Resolve sources from public records; URL query parameters are never fetched. */
export async function resolveRecordImage(
  kind: string,
  id: string,
  read: (path: string) => Promise<Response>,
  mirror: Pick<MediaMirror, "capture">
) {
  const key =
    /^(1|8453|42161|666666666):0x[a-fA-F0-9]{40}:(0|[1-9][0-9]{0,77})$/;
  if (
    !((kind === "bounty" || kind === "claim") && key.test(id)) &&
    !(kind === "profile" && /^0x[a-fA-F0-9]{40}$/.test(id))
  )
    return Response.json({ error: "Not found" }, { status: 404 });
  const response = await read(
    kind === "profile"
      ? "/api/v1/records?kind=profile&author=" + id.toLowerCase()
      : "/api/v1/" +
          (kind === "bounty" ? "bounties/" : "claims/") +
          encodeURIComponent(id)
  );
  if (!response.ok)
    return Response.json(
      { error: "Public record unavailable" },
      { status: response.status }
    );
  const record = await response.json();
  let source: string | null;
  if (kind === "profile") {
    const profile = record.items?.find(
      (item: any) =>
        item.kind === "profile" &&
        item.author.toLowerCase() === id.toLowerCase() &&
        !item.deletedAt &&
        !item.moderated
    );
    source =
      typeof profile?.data?.image === "string" ? profile.data.image : null;
  } else {
    if (record.id?.toLowerCase() !== id.toLowerCase())
      return Response.json({ error: "Record mismatch" }, { status: 502 });
    source =
      kind === "bounty"
        ? cardMedia(record.description ?? "", record.image).image
        : typeof record.uri === "string"
        ? record.uri
        : null;
  }
  if (!source) return Response.json({ error: "No image" }, { status: 404 });
  try {
    const capture = await mirror.capture(source, kind === "claim");
    return Response.json(
      {
        url: "/media/remote/sha256/" + capture.sha256,
        sha256: capture.sha256,
        source,
        capturedAt: capture.capturedAt,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "X-Poidh-Media-Storage": "persistent",
        },
      }
    );
  } catch {
    return Response.json(
      { error: "Image preview unavailable" },
      {
        status: 422,
        headers: { "Cache-Control": "public, max-age=30" },
      }
    );
  }
}
