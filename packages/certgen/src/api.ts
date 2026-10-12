import { readFileSync } from "node:fs";
import { request } from "node:https";
import type { Api, KubeObject } from "./commands";

const ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";

interface Answer {
  status: number;
  body: string;
}

function call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${readFileSync(`${ACCOUNT}/token`, "utf8")}`,
      accept: "application/json",
    };
    if (body !== undefined) headers["content-type"] = contentType;
    const outgoing = request(
      {
        host: process.env.KUBERNETES_SERVICE_HOST,
        port: process.env.KUBERNETES_SERVICE_PORT,
        ca: readFileSync(`${ACCOUNT}/ca.crt`),
        method,
        path,
        headers,
      },
      (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (text += chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: text }));
      },
    );
    outgoing.on("error", reject);
    if (body !== undefined) outgoing.write(JSON.stringify(body));
    outgoing.end();
  });
}

// The answer of the API server is left out of the message: it can repeat the request.
const refused = (method: string, path: string, status: number): Error =>
  new Error(`${method} ${path} was answered with ${status}`);

/**
 * Makes the calls to the API server of the cluster that the pod runs in, as the pod's ServiceAccount.
 * @returns The four calls.
 */
export function clusterApi(): Api {
  return {
    async get(path) {
      const answer = await call("GET", path);
      if (answer.status === 404) return undefined;
      if (answer.status !== 200) throw refused("GET", path, answer.status);
      return JSON.parse(answer.body) as KubeObject;
    },
    async create(path, body) {
      const answer = await call("POST", path, body);
      if (answer.status === 409) return "exists";
      if (answer.status !== 201) throw refused("POST", path, answer.status);
      return "created";
    },
    async patch(path, operations) {
      const answer = await call("PATCH", path, operations, "application/json-patch+json");
      if (answer.status !== 200) throw refused("PATCH", path, answer.status);
    },
    async remove(path) {
      const answer = await call("DELETE", path);
      if (![200, 202, 404].includes(answer.status)) throw refused("DELETE", path, answer.status);
    },
  };
}
