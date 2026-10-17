import { createServer, type Server } from "node:http";
import { handle, type ReceiverDeps } from "./handler";
import { errorName } from "./log";

// EventBridge allows events of up to 1 MB, but a store event is a few KB, and the body is read before the token.
const MAX_BODY_BYTES = 64 * 1024;

// Longer than the 350 s idle timeout of an NLB.
const KEEP_ALIVE_TIMEOUT_MS = 400_000;
// Node needs the header timeout to be longer than the keep-alive timeout.
const HEADERS_TIMEOUT_MS = 405_000;

/**
 * Makes the HTTP server of the receiver.
 * @param deps The token, the lists of the cluster and the way to ask for a sync.
 * @returns A server that is not listening yet.
 */
export function createReceiver(deps: ReceiverDeps): Server {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      const reply = (status: number, body: string) => {
        response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
        response.end(request.method === "HEAD" ? undefined : body);
      };
      if (size > MAX_BODY_BYTES) return reply(413, "the body is too large");
      handle(
        {
          method: request.method ?? "",
          path: (request.url ?? "").split("?")[0] ?? "",
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        },
        deps,
      )
        .then((answer) => reply(answer.status, answer.body))
        .catch((error: unknown) => {
          deps.log("KMO receiver failed", { error: errorName(error) });
          reply(500, "internal error");
        });
    });
  });
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}
