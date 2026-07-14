import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { DatabaseReadinessProbe } from "./database-readiness.ts";

export const CLOUD_RUN_LISTEN_HOST = "0.0.0.0";
export const CLOUD_RUN_DEFAULT_PORT = 8_080;

export type FoundationServerOptions = {
  readiness: DatabaseReadinessProbe;
  /**
   * Closes the owned database handle. The production handle drains the pg pool
   * before it closes its Cloud SQL connector.
   */
  closeDatabase: () => Promise<void>;
  readinessTimeoutMs?: number;
  shutdownTimeoutMs?: number;
};

export type FoundationListenOptions = {
  host?: string;
  port: number;
};

export type FoundationServerController = {
  readonly server: Server;
  readonly isDraining: boolean;
  beginDraining(): void;
  listen(options: FoundationListenOptions): Promise<AddressInfo>;
  shutdown(): Promise<void>;
};

const DEFAULT_READINESS_TIMEOUT_MS = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_OPERATION_TIMEOUT_MS = 60_000;

function validatedTimeout(value: number | undefined, fallback: number, label: string) {
  const timeout = value ?? fallback;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_OPERATION_TIMEOUT_MS
  ) {
    throw new TypeError(`${label} must be an integer from 1 to ${MAX_OPERATION_TIMEOUT_MS} ms`);
  }
  return timeout;
}

function validatedPort(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new TypeError("Foundation server port must be an integer from 0 to 65535");
  }
  return value;
}

function jsonResponse(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: Record<string, string>,
) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else response.end(payload);
}

function requestPath(request: IncomingMessage) {
  try {
    return new URL(request.url ?? "/", "http://foundation.invalid").pathname;
  } catch {
    return null;
  }
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function closeServer(server: Server) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

export function createFoundationServer(
  options: FoundationServerOptions,
): FoundationServerController {
  const readinessTimeoutMs = validatedTimeout(
    options.readinessTimeoutMs,
    DEFAULT_READINESS_TIMEOUT_MS,
    "Foundation readiness timeout",
  );
  const shutdownTimeoutMs = validatedTimeout(
    options.shutdownTimeoutMs,
    DEFAULT_SHUTDOWN_TIMEOUT_MS,
    "Foundation shutdown timeout",
  );
  let draining = false;
  let shutdownPromise: Promise<void> | undefined;

  const server = createServer((request, response) => {
    void (async () => {
      const path = requestPath(request);
      const methodAllowed = request.method === "GET" || request.method === "HEAD";

      if ((path === "/healthz" || path === "/readyz") && !methodAllowed) {
        response.setHeader("Allow", "GET, HEAD");
        jsonResponse(request, response, 405, { error: "method_not_allowed" });
        return;
      }

      if (path === "/healthz") {
        // Liveness is process-only. Database failure must not create a restart
        // storm, and draining remains live until the HTTP server closes.
        jsonResponse(request, response, 200, { status: "ok" });
        return;
      }

      if (path === "/readyz") {
        let ready = false;
        if (!draining) {
          try {
            ready = await timeoutPromise(
              options.readiness.check(),
              readinessTimeoutMs,
              "Database readiness check",
            );
          } catch {
            ready = false;
          }
        }
        jsonResponse(
          request,
          response,
          ready ? 200 : 503,
          { status: ready ? "ready" : "unavailable" },
        );
        return;
      }

      // This image proves only the Cloud Run and Cloud SQL runtime boundary.
      // It must not make the current Cloudflare-bound application appear ready.
      jsonResponse(request, response, 503, {
        error: "production_app_not_composed",
      });
    })().catch(() => {
      if (!response.headersSent) {
        jsonResponse(request, response, 503, { status: "unavailable" });
      } else {
        response.destroy();
      }
    });
  });

  const controller: FoundationServerController = {
    server,

    get isDraining() {
      return draining;
    },

    beginDraining() {
      if (draining) return;
      draining = true;
      options.readiness.invalidate();
    },

    listen(listenOptions) {
      const host = listenOptions.host ?? CLOUD_RUN_LISTEN_HOST;
      const port = validatedPort(listenOptions.port);
      if (!host.trim()) throw new TypeError("Foundation server host is required");
      if (server.listening) throw new Error("Foundation server is already listening");

      return new Promise<AddressInfo>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("Foundation server did not expose a TCP address"));
            return;
          }
          resolve(address);
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    },

    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      controller.beginDraining();
      const deadline = Date.now() + shutdownTimeoutMs;
      const remaining = () => Math.max(1, deadline - Date.now());

      shutdownPromise = (async () => {
        const failures: unknown[] = [];
        try {
          await timeoutPromise(closeServer(server), remaining(), "HTTP shutdown");
        } catch (error) {
          failures.push(error);
          // After the grace window, do not let an unresponsive keep-alive or
          // request prevent database cleanup from starting.
          server.closeAllConnections?.();
        }

        try {
          // The owned database handle is responsible for closing its pg pool
          // before its Cloud SQL connector. Invoke it only after HTTP draining.
          await timeoutPromise(
            Promise.resolve().then(options.closeDatabase),
            remaining(),
            "Database shutdown",
          );
        } catch (error) {
          failures.push(error);
        }

        if (failures.length > 0) {
          throw new AggregateError(failures, "Foundation server shutdown did not complete cleanly");
        }
      })();
      return shutdownPromise;
    },
  };

  return controller;
}
