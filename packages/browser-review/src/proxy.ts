// SPDX-License-Identifier: Apache-2.0
import http from "node:http";
import net from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { injectOverlay } from "./instrument.js";
import { send } from "./http-util.js";

/** Headers that describe a single hop and must not be forwarded. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface ProxyOptions {
  upstream: URL;
  /** Absolute base path of this session, e.g. `/r/<token>`. */
  basePath: string;
  selfOrigin: string;
  overlayUrl: string;
  overlayConfig: unknown;
  onWarning: (message: string) => void;
}

function filterRequestHeaders(headers: IncomingMessage["headers"], upstream: URL) {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key)) continue;
    out[key] = value;
  }
  out["host"] = upstream.host;
  // Ask for plain bytes: an HTML body has to be readable to have the overlay
  // spliced into it, and re-compressing it would buy nothing over loopback.
  out["accept-encoding"] = "identity";
  return out;
}

function rewriteLocation(location: string, opts: ProxyOptions): string {
  const upstreamOrigin = opts.upstream.origin;
  if (location.startsWith(upstreamOrigin)) {
    return opts.selfOrigin + opts.basePath + location.slice(upstreamOrigin.length);
  }
  if (location.startsWith("/")) return opts.basePath + location;
  return location;
}

/**
 * Forward one request to the dev server, splicing the overlay into any HTML
 * that comes back.
 */
export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamPath: string,
  opts: ProxyOptions,
): void {
  const upstreamReq = http.request(
    {
      protocol: opts.upstream.protocol,
      hostname: opts.upstream.hostname,
      port: opts.upstream.port || 80,
      method: req.method,
      path: upstreamPath,
      headers: filterRequestHeaders(req.headers, opts.upstream),
    },
    (upstreamRes) => {
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key)) continue;
        headers[key] = value;
      }

      if (typeof headers["location"] === "string") {
        headers["location"] = rewriteLocation(headers["location"], opts);
      }

      // A dev server's CSP is written for its own origin and would block the
      // overlay. This is a loopback-only review tool, so we drop the header and
      // say so rather than silently shipping a page that half works.
      for (const name of ["content-security-policy", "content-security-policy-report-only"]) {
        if (headers[name]) {
          opts.onWarning(
            `upstream sent ${name}; removing it for the reviewed page so the overlay can load`,
          );
          delete headers[name];
        }
      }

      const contentType = String(upstreamRes.headers["content-type"] ?? "");
      if (!contentType.includes("text/html")) {
        res.writeHead(upstreamRes.statusCode ?? 502, headers);
        upstreamRes.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstreamRes.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8");
        const injected = injectOverlay(html, opts.overlayUrl, opts.overlayConfig);
        const body = Buffer.from(injected, "utf8");
        delete headers["content-length"];
        headers["content-length"] = String(body.byteLength);
        res.writeHead(upstreamRes.statusCode ?? 200, headers);
        res.end(body);
      });
      upstreamRes.on("error", () => res.destroy());
    },
  );

  upstreamReq.on("error", (err) => {
    send(
      res,
      502,
      `browser-review could not reach ${opts.upstream.origin}: ${(err as Error).message}\n` +
        "Is the dev server still running?\n",
      { "content-type": "text/plain; charset=utf-8" },
    );
  });

  req.pipe(upstreamReq);
}

/**
 * Pass a WebSocket upgrade straight through to the dev server.
 *
 * Vite and friends run hot-module-reload over their own socket; the review
 * session is useless if that stops working, so everything except our own
 * control socket is tunnelled byte for byte.
 */
export function proxyUpgrade(
  req: IncomingMessage,
  clientSocket: Duplex,
  head: Buffer,
  upstreamPath: string,
  opts: ProxyOptions,
): void {
  const upstreamReq = http.request({
    protocol: opts.upstream.protocol,
    hostname: opts.upstream.hostname,
    port: opts.upstream.port || 80,
    method: req.method,
    path: upstreamPath,
    headers: { ...req.headers, host: opts.upstream.host },
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket: net.Socket, upstreamHead: Buffer) => {
    const statusLine = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
    const headerLines = Object.entries(upstreamRes.headers)
      .flatMap(([key, value]) =>
        Array.isArray(value) ? value.map((v) => `${key}: ${v}`) : [`${key}: ${value}`],
      )
      .join("\r\n");
    clientSocket.write(`${statusLine}${headerLines}\r\n\r\n`);
    if (upstreamHead?.byteLength) clientSocket.write(upstreamHead);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstreamSocket.destroy());
  });

  upstreamReq.on("error", () => clientSocket.destroy());
  upstreamReq.end(head?.byteLength ? head : undefined);
}
