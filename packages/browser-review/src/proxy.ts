// SPDX-License-Identifier: Apache-2.0
import http from "node:http";
import net from "node:net";
import { brotliDecompressSync, unzipSync } from "node:zlib";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { injectOverlay } from "./instrument.js";
import { send } from "./http-util.js";

const MAX_HTML_BYTES = 16 * 1024 * 1024;

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
  appCookieName?: string;
}

function filterRequestHeaders(
  headers: IncomingMessage["headers"],
  upstream: URL,
  cookieName?: string,
) {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key)) continue;
    if (key === "cookie" && typeof value === "string") {
      out[key] = value
        .split(";")
        .filter(
          (part) => !/^br_app_\d+=/.test(part.trim()) && !part.trim().startsWith(`${cookieName}=`),
        )
        .join(";");
    } else out[key] = value;
  }
  out["host"] = upstream.host;
  // Ask for plain bytes: an HTML body has to be readable to have the overlay
  // spliced into it, and re-compressing it would buy nothing over loopback.
  out["accept-encoding"] = "identity";
  return out;
}

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Point a redirect back at the review server.
 *
 * Matching on the port rather than the whole origin matters: a dev server told
 * to listen on `localhost` routinely answers with `127.0.0.1` in `Location`,
 * and a string comparison against the origin the user typed would miss it and
 * send the browser straight past the overlay.
 */
export function rewriteLocation(location: string, opts: ProxyOptions): string {
  if (location.startsWith("/") && !location.startsWith("//")) return opts.basePath + location;
  let url: URL;
  try {
    url = new URL(location, location.startsWith("//") ? opts.upstream : undefined);
  } catch {
    return location;
  }
  const samePort = (url.port || "80") === (opts.upstream.port || "80");
  if (url.protocol === "http:" && samePort && LOOPBACK_NAMES.has(url.hostname)) {
    return opts.selfOrigin + opts.basePath + url.pathname + url.search + url.hash;
  }
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
      hostname: opts.upstream.hostname.replace(/^\[|\]$/g, ""),
      port: opts.upstream.port || 80,
      method: req.method,
      path: upstreamPath,
      headers: filterRequestHeaders(req.headers, opts.upstream, opts.appCookieName),
    },
    (upstreamRes) => {
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key)) continue;
        headers[key] = value;
      }

      const ownCookies = res.getHeader("set-cookie");
      if (ownCookies && headers["set-cookie"]) {
        headers["set-cookie"] = [String(ownCookies), ...[headers["set-cookie"]].flat()];
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
      upstreamRes.on("error", () => res.destroy());
      if (
        req.method === "HEAD" ||
        upstreamRes.statusCode === 204 ||
        upstreamRes.statusCode === 304 ||
        !contentType.toLowerCase().includes("text/html")
      ) {
        res.writeHead(upstreamRes.statusCode ?? 502, headers);
        upstreamRes.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      upstreamRes.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_HTML_BYTES) {
          upstreamRes.destroy();
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on("end", () => {
        let bytes = Buffer.concat(chunks);
        const encoding = String(headers["content-encoding"] ?? "identity").toLowerCase();
        try {
          if (encoding === "br")
            bytes = brotliDecompressSync(bytes, { maxOutputLength: MAX_HTML_BYTES });
          else if (encoding === "gzip" || encoding === "deflate")
            bytes = unzipSync(bytes, { maxOutputLength: MAX_HTML_BYTES });
          else if (encoding !== "identity") throw new Error("unsupported content encoding");
        } catch {
          send(res, 502, "browser-review: unable to decode upstream HTML\n");
          return;
        }
        delete headers["content-encoding"];
        const html = bytes.toString("utf8");
        const injected = injectOverlay(html, opts.overlayUrl, opts.overlayConfig);
        const body = Buffer.from(injected, "utf8");
        delete headers["etag"];
        delete headers["content-md5"];
        delete headers["content-length"];
        headers["content-length"] = String(body.byteLength);
        res.writeHead(upstreamRes.statusCode ?? 200, headers);
        res.end(body);
      });
    },
  );

  upstreamReq.on("error", (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
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
    hostname: opts.upstream.hostname.replace(/^\[|\]$/g, ""),
    port: opts.upstream.port || 80,
    method: req.method,
    path: upstreamPath,
    headers: {
      ...filterRequestHeaders(req.headers, opts.upstream, opts.appCookieName),
      connection: "Upgrade",
      upgrade: req.headers.upgrade ?? "websocket",
    },
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
    if (head.byteLength) upstreamSocket.write(head);
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstreamSocket.destroy());
    clientSocket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("close", () => clientSocket.destroy());
  });

  upstreamReq.on("error", () => clientSocket.destroy());
  upstreamReq.on("response", (response) => {
    response.resume();
    clientSocket.destroy();
  });
  clientSocket.on("close", () => upstreamReq.destroy());
  upstreamReq.end();
}
