import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { Readable } from "node:stream";
import { publicMediaURL } from "./mirror";

export function publicIPv4(address: string) {
  if (
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address) ||
    address.split(".").some((part) => Number(part) > 255)
  )
    return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/** Pin the socket to a validated public A record, retaining HTTPS hostname/SNI.
 * A DNS check followed by ordinary fetch would allow DNS rebinding. */
export const nodeMediaFetch: typeof fetch = async (input, init) => {
  const url = publicMediaURL(String(input));
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpsRequest(
      url,
      {
        method: "GET",
        agent: false,
        family: 4,
        signal: init?.signal ?? undefined,
        headers: {
          Accept: "image/*, application/json;q=0.9",
          "Accept-Encoding": "identity",
        },
        lookup(host, options, callback) {
          lookup(host, { family: 4, all: true }, (error, addresses) => {
            const address = addresses?.find((entry) =>
              publicIPv4(entry.address)
            );
            if (error || !address)
              return callback(
                error ?? new Error("Private media destination blocked"),
                "",
                4
              );
            if (options.all) callback(null, [address] as any);
            else callback(null, address.address, 4);
          });
        },
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        const status = incoming.statusCode ?? 502;
        resolve(
          new Response(
            [204, 205, 304].includes(status)
              ? null
              : (Readable.toWeb(incoming) as ReadableStream),
            { status, headers }
          )
        );
      }
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
};
