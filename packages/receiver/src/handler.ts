import { timingSafeEqual } from "node:crypto";
import {
  MalformedEventError,
  findAffectedSyncs,
  isSuspended,
  normalizeEventBridgeEvent,
  normalizeRustfsEvent,
  type ConfigSync,
  type Store,
  type StoreEvent,
} from "@kmo/core";
import { errorName, type Log } from "./log";

/** The parts of an HTTP request that the receiver reads. */
export interface ReceiverRequest {
  /** The HTTP method, in capitals. */
  method: string;
  /** The path, without a query. */
  path: string;
  /** The value of the Authorization header. */
  authorization?: string;
  /** The body as text. */
  body: string;
}

/** The receiver's answer to one request. */
export interface ReceiverResponse {
  /** The HTTP status code. */
  status: number;
  /** A short text for people. */
  body: string;
}

/** What the receiver needs from outside; replaced in tests. */
export interface ReceiverDeps {
  /** The shared bearer token. */
  token: string;
  /** Tells whether every list of the cluster was filled once. */
  ready(): boolean;
  /** Every ConfigSync in the cluster. */
  syncs(): ConfigSync[];
  /** Every ConfigStore and ClusterConfigStore in the cluster. */
  stores(): Store[];
  /** Asks for a sync of one ConfigSync. */
  requestSync(sync: ConfigSync): Promise<void>;
  /** Writes a log line. */
  log: Log;
}

const NORMALIZERS: Record<string, (body: unknown) => StoreEvent[]> = {
  "/events/rustfs": normalizeRustfsEvent,
  "/events/eventbridge": normalizeEventBridgeEvent,
};

const answer = (status: number, body: string): ReceiverResponse => ({ status, body });

/**
 * Answers one request.
 * @param request The request.
 * @param deps The token, the lists of the cluster and the way to ask for a sync.
 * @returns 200 when every affected ConfigSync was asked to sync, also when there is none; 400 for a body that is not
 *   an event; 401 for a bad token; 500 when a sync request failed; 503 before the lists are filled.
 */
export async function handle(request: ReceiverRequest, deps: ReceiverDeps): Promise<ReceiverResponse> {
  const { method, path } = request;
  if (path === "/" && method === "HEAD") return answer(200, "");
  if (path === "/healthz") return answer(200, "ok");
  if (path === "/readyz") return deps.ready() ? answer(200, "ready") : answer(503, "not ready");

  const normalize = NORMALIZERS[path];
  if (!normalize) return answer(404, "not found");
  if (method !== "POST") return answer(405, "method not allowed");
  if (!authorized(request.authorization, deps.token)) return answer(401, "unauthorized");
  if (!deps.ready()) return answer(503, "not ready");

  let events: StoreEvent[];
  try {
    events = normalize(JSON.parse(request.body));
  } catch (error) {
    if (error instanceof SyntaxError) return answer(400, "the body is not JSON");
    if (error instanceof MalformedEventError) return answer(400, error.message);
    throw error;
  }

  const affected = affectedSyncs(events, deps.syncs(), deps.stores());
  const results = await Promise.allSettled(affected.map((sync) => deps.requestSync(sync)));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  deps.log("KMO receiver handled an event", {
    path,
    files: events.map((event) => `${event.bucket}/${event.key}`),
    requested: affected.map((sync) => `${sync.metadata.namespace}/${sync.metadata.name}`),
    failed: failures.length,
    ...(failures[0] ? { error: errorName(failures[0].reason) } : {}),
  });
  if (failures.length > 0) return answer(500, `${failures.length} sync requests failed`);
  return answer(200, `${affected.length} sync requests`);
}

function authorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function affectedSyncs(events: StoreEvent[], syncs: ConfigSync[], stores: Store[]): ConfigSync[] {
  const found = new Map<string, ConfigSync>();
  for (const event of events) {
    for (const sync of findAffectedSyncs(event, syncs, stores)) {
      if (!isSuspended(sync)) found.set(`${sync.metadata.namespace}/${sync.metadata.name}`, sync);
    }
  }
  return [...found.values()];
}
