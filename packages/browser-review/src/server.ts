// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar, { type FSWatcher } from "chokidar";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  Annotation,
  ClientMessage,
  ServerMessage,
  Session,
  SessionMode,
} from "@browser-review/shared";
import { createMcpServer, sessionContextForId } from "./mcp.js";
import { PollDelivery } from "./delivery/poll.js";
import { createAnnotation } from "./annotations.js";
import { injectOverlay, instrumentHtml } from "./instrument.js";
import { proxyRequest, proxyUpgrade, type ProxyOptions } from "./proxy.js";
import {
  classifyOrigin,
  contentTypeFor,
  hostIsLoopback,
  readJsonBody,
  send,
  sendJson,
  sendNotFound,
} from "./http-util.js";
import { pendingOf, readSessionFile, updateSessionFile, writeSessionFile } from "./store.js";
import { sessionsDir } from "./paths.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Control endpoints sit under `__br/` rather than directly under the session
 * path. In proxy mode every other path belongs to the application being
 * reviewed, and names like `/feed` or `/resolve` are common enough in real apps
 * that mounting ours at the root would shadow them.
 */
const CONTROL_PREFIX = "__br";

export interface StartOptions {
  id: string;
  token: string;
  mode: SessionMode;
  /** Absolute file path (html-file) or upstream origin URL (proxy). */
  target: string;
  projectDir: string;
  /** 0 asks the OS for a free port. */
  port: number;
  /** Path the review URL opens on. Proxy mode only. */
  entryPath?: string;
}

export interface RunningServer {
  session: Session;
  close(): Promise<void>;
}

/**
 * Where the built overlay lives.
 *
 * Next to the bundled CLI when installed, and one directory over in `dist/`
 * when the tests run this file straight from `src/`.
 */
function overlayBundlePath(): string {
  const candidates = [
    path.join(MODULE_DIR, "overlay.js"),
    path.join(MODULE_DIR, "..", "dist", "overlay.js"),
  ];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) ?? candidates[0]!;
}

export async function startReviewServer(opts: StartOptions): Promise<RunningServer> {
  const basePath = `/r/${opts.token}`;
  const controlBase = `${basePath}/${CONTROL_PREFIX}`;
  const events = new EventEmitter();
  const sockets = new Set<WebSocket>();
  const sseClients = new Set<http.ServerResponse>();
  const delivery = new PollDelivery();
  const warned = new Set<string>();

  const overlaySource = await fs.readFile(overlayBundlePath(), "utf8").catch(() => {
    throw new Error(
      `overlay bundle missing at ${overlayBundlePath()}. Run \`npm run build\` in the repository.`,
    );
  });

  const staticRoot = opts.mode === "html-file" ? path.dirname(opts.target) : "";
  const upstream = opts.mode === "proxy" ? new URL(opts.target) : null;

  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  const selfOrigin = `http://127.0.0.1:${port}`;

  const session: Session = {
    id: opts.id,
    token: opts.token,
    mode: opts.mode,
    target: opts.target,
    projectDir: opts.projectDir,
    port,
    pid: process.pid,
    createdAt: new Date().toISOString(),
    ...(opts.entryPath ? { entryPath: opts.entryPath } : {}),
  };
  await writeSessionFile({ session, annotations: [] });

  const overlayConfig = {
    base: basePath,
    control: `${basePath}/${CONTROL_PREFIX}`,
    mode: opts.mode,
    version: "0.1.0",
  };

  const warn = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    process.stderr.write(`browser-review: ${message}\n`);
  };

  const proxyOptions: ProxyOptions | null = upstream
    ? {
        upstream,
        basePath,
        selfOrigin,
        overlayUrl: `${controlBase}/overlay.js`,
        overlayConfig,
        onWarning: warn,
      }
    : null;

  /* ---------------------------------------------------------------- push --- */

  const broadcast = (message: ServerMessage): void => {
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  };

  const pushSse = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) client.write(frame);
  };

  events.on("annotation", (annotation: Annotation) => {
    broadcast({ type: "updated", annotation });
    pushSse("annotation", annotation);
  });

  /* ------------------------------------------------------- html-file mode --- */

  const readHtml = async (file: string): Promise<string> => {
    const raw = await fs.readFile(file, "utf8");
    const rel = path.relative(opts.projectDir, file) || path.basename(file);
    const instrumented = instrumentHtml(raw, rel);
    return injectOverlay(instrumented, `${controlBase}/overlay.js`, overlayConfig);
  };

  const serveStatic = async (res: http.ServerResponse, rest: string): Promise<void> => {
    const relative = rest === "" || rest === "/" ? path.basename(opts.target) : rest.slice(1);
    const resolved = path.resolve(staticRoot, decodeURIComponent(relative));
    const root = path.resolve(staticRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return sendNotFound(res);

    let stat: fsSync.Stats;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return sendNotFound(res);
    }
    if (stat.isDirectory()) return sendNotFound(res);

    const ext = path.extname(resolved);
    if (ext === ".html" || ext === ".htm") {
      return send(res, 200, await readHtml(resolved), { "content-type": contentTypeFor(ext) });
    }
    return send(res, 200, await fs.readFile(resolved), { "content-type": contentTypeFor(ext) });
  };

  /* -------------------------------------------------------------- routing --- */

  const handleControl = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    route: string,
    url: URL,
  ): Promise<boolean> => {
    const origin = classifyOrigin(req, port);

    if (route === "/overlay.js") {
      send(res, 200, overlaySource, { "content-type": "text/javascript; charset=utf-8" });
      return true;
    }

    if (route === "/mcp") {
      // Command-line MCP clients send no Origin. A browser always does, so an
      // Origin header here means a web page is talking to the tool endpoint.
      if (origin !== "absent") {
        sendNotFound(res);
        return true;
      }
      await handleMcp(req, res);
      return true;
    }

    if (route === "/pending" && req.method === "GET") {
      const file = await readSessionFile(opts.id);
      sendJson(res, 200, { annotations: file ? pendingOf(file) : [] });
      return true;
    }

    if (route === "/annotations" && req.method === "GET") {
      const file = await readSessionFile(opts.id);
      const status = url.searchParams.get("status");
      const rows = (file?.annotations ?? []).filter((a) => !status || a.status === status);
      sendJson(res, 200, { annotations: rows });
      return true;
    }

    if (route === "/feed" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      const file = await readSessionFile(opts.id);
      for (const annotation of file ? pendingOf(file) : []) {
        res.write(`event: annotation\ndata: ${JSON.stringify(annotation)}\n\n`);
      }
      sseClients.add(res);
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(res);
      });
      return true;
    }

    if ((route === "/resolve" || route === "/ask" || route === "/dismiss") && req.method === "POST") {
      if (origin === "foreign") {
        sendNotFound(res);
        return true;
      }
      let body: Record<string, unknown>;
      try {
        body = ((await readJsonBody(req)) ?? {}) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: "invalid JSON body" });
        return true;
      }
      const id = typeof body["id"] === "string" ? body["id"] : "";
      const file = await readSessionFile(opts.id);
      if (!file?.annotations.some((a) => a.id === id)) {
        sendJson(res, 404, { error: `no annotation ${id}` });
        return true;
      }
      const updated = await updateSessionFile(opts.id, (current) => {
        const annotation = current.annotations.find((a) => a.id === id);
        if (!annotation) return;
        if (route === "/resolve") {
          annotation.status = "resolved";
          annotation.resolution = {
            summary: String(body["summary"] ?? "").slice(0, 1_000),
            filesChanged: Array.isArray(body["filesChanged"])
              ? (body["filesChanged"] as unknown[]).map(String).slice(0, 50)
              : [],
            at: new Date().toISOString(),
          };
        } else if (route === "/dismiss") {
          annotation.status = "dismissed";
          annotation.resolution = {
            summary: String(body["reason"] ?? "").slice(0, 1_000),
            filesChanged: [],
            at: new Date().toISOString(),
          };
        } else {
          annotation.questions.push({
            from: "agent",
            text: String(body["question"] ?? "").slice(0, 2_000),
            at: new Date().toISOString(),
          });
        }
      });
      const annotation = updated.annotations.find((a) => a.id === id)!;
      events.emit("annotation", annotation);
      sendJson(res, 200, { ok: true, annotation });
      return true;
    }

    return false;
  };

  const handleMcp = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    // Stateless: one server and transport per request, so a long review_wait on
    // one connection cannot block another client.
    const { StreamableHTTPServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/streamableHttp.js"
    );
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = createMcpServer({
      resolveSession: sessionContextForId(opts.id),
      delivery,
    });
    res.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });
    await mcpServer.connect(transport);
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    await transport.handleRequest(req, res, body);
  };

  server.on("request", (req, res) => {
    void (async () => {
      try {
        if (!hostIsLoopback(req)) return sendNotFound(res);
        const url = new URL(req.url ?? "/", selfOrigin);
        if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
          return sendNotFound(res);
        }
        const rest = url.pathname.slice(basePath.length);

        if (rest === `/${CONTROL_PREFIX}` || rest.startsWith(`/${CONTROL_PREFIX}/`)) {
          const route = rest.slice(`/${CONTROL_PREFIX}`.length) || "/";
          if (await handleControl(req, res, route, url)) return;
          return sendNotFound(res);
        }

        if (proxyOptions) {
          const upstreamPath = (rest === "" ? "/" : rest) + url.search;
          return proxyRequest(req, res, upstreamPath, proxyOptions);
        }
        return await serveStatic(res, rest);
      } catch (err) {
        warn(`request failed: ${(err as Error).message}`);
        if (!res.headersSent) send(res, 500, "browser-review: internal error\n");
        else res.destroy();
      }
    })();
  });

  /* ------------------------------------------------------------ websocket --- */

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket: WebSocket) => {
    sockets.add(socket);
    void (async () => {
      const file = await readSessionFile(opts.id);
      const init: ServerMessage = {
        type: "init",
        annotations: file?.annotations ?? [],
        mode: opts.mode,
      };
      socket.send(JSON.stringify(init));
      // Agent questions are considered delivered once a browser has them.
      await updateSessionFile(opts.id, (current) => {
        for (const annotation of current.annotations) {
          for (const question of annotation.questions) {
            if (question.from === "agent") question.delivered = true;
          }
        }
      }).catch(() => undefined);
    })();

    socket.on("message", (raw) => {
      void (async () => {
        let message: ClientMessage;
        try {
          message = JSON.parse(String(raw)) as ClientMessage;
        } catch {
          return;
        }
        if (message.type === "annotate") {
          const annotation = createAnnotation(opts.id, message.annotation);
          if (annotation.comment === "") return;
          await updateSessionFile(opts.id, (current) => {
            current.annotations.push(annotation);
          });
          events.emit("annotation", annotation);
        } else if (message.type === "answer") {
          const updated = await updateSessionFile(opts.id, (current) => {
            const annotation = current.annotations.find((a) => a.id === message.id);
            if (!annotation) return;
            annotation.questions.push({
              from: "human",
              text: String(message.text).slice(0, 2_000),
              at: new Date().toISOString(),
              delivered: false,
            });
          }).catch(() => null);
          const annotation = updated?.annotations.find((a) => a.id === message.id);
          if (annotation) events.emit("annotation", annotation);
        }
      })();
    });

    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  server.on("upgrade", (req, socket, head) => {
    if (!hostIsLoopback(req)) return socket.destroy();
    const url = new URL(req.url ?? "/", selfOrigin);
    if (url.pathname === `${controlBase}/ws`) {
      if (classifyOrigin(req, port) !== "same-origin") return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
      return;
    }
    if (proxyOptions && url.pathname.startsWith(`${basePath}/`)) {
      const upstreamPath = url.pathname.slice(basePath.length) + url.search;
      return proxyUpgrade(req, socket, head, upstreamPath || "/", proxyOptions);
    }
    socket.destroy();
  });

  /* -------------------------------------------------------------- watches --- */

  const watchers: FSWatcher[] = [];

  if (opts.mode === "html-file") {
    const watcher = chokidar.watch(staticRoot, {
      ignoreInitial: true,
      ignored: (candidate) => candidate.includes(`${path.sep}node_modules${path.sep}`),
      awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
    });
    watcher.on("all", () => broadcast({ type: "reload" }));
    watcher.on("error", () => undefined);
    watchers.push(watcher);
  }

  // The stdio MCP process edits the same session file. Watching it is how the
  // browser learns that an annotation was resolved by an agent in another
  // process.
  let snapshot = new Map<string, string>();
  const refreshFromDisk = async (): Promise<void> => {
    const file = await readSessionFile(opts.id).catch(() => null);
    if (!file) return;
    const next = new Map<string, string>();
    for (const annotation of file.annotations) {
      const stamp = JSON.stringify([
        annotation.status,
        annotation.resolution?.at ?? null,
        annotation.questions.length,
      ]);
      next.set(annotation.id, stamp);
      if (snapshot.get(annotation.id) !== stamp) {
        broadcast({ type: "updated", annotation });
        pushSse("annotation", annotation);
      }
    }
    snapshot = next;
  };
  await refreshFromDisk();

  // Watch the directory rather than the file: every write replaces the inode.
  const stateWatcher = chokidar.watch(sessionsDir(), {
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
  });
  stateWatcher.on("all", () => void refreshFromDisk());
  stateWatcher.on("error", () => undefined);
  watchers.push(stateWatcher);

  // Filesystem events are missed often enough — atomic renames, network mounts
  // — that a human would notice the pin not turning green. Half a second is not.
  const pollTimer = setInterval(() => void refreshFromDisk(), 500);

  /* ---------------------------------------------------------------- close --- */

  const close = async (): Promise<void> => {
    clearInterval(pollTimer);
    for (const client of sseClients) client.end();
    sseClients.clear();
    for (const socket of sockets) socket.close();
    sockets.clear();
    wss.close();
    await Promise.all(watchers.map((w) => w.close()));
    await delivery.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await updateSessionFile(opts.id, (current) => {
      current.session.closedAt = new Date().toISOString();
    }).catch(() => undefined);
  };

  return { session, close };
}
