// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage, ServerResponse } from "node:http";

const JSON_BODY_LIMIT = 1024 * 256;

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Origins a browser may legitimately use to reach this server. */
export function allowedOrigins(port: number): Set<string> {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
}

function hostname(header: string | undefined): string {
  if (!header) return "";
  if (header.startsWith("[")) return header.slice(0, header.indexOf("]") + 1);
  const colon = header.lastIndexOf(":");
  return colon === -1 ? header : header.slice(0, colon);
}

/**
 * Reject requests whose `Host` is not a loopback name.
 *
 * A page on an attacker's domain can resolve that domain to 127.0.0.1 and reach
 * this server from the victim's browser; the `Host` header is the one part of
 * such a request the attacker cannot forge away.
 */
export function hostIsLoopback(req: IncomingMessage): boolean {
  return LOOPBACK_HOSTS.has(hostname(req.headers.host));
}

export type OriginVerdict = "same-origin" | "absent" | "foreign";

export function classifyOrigin(req: IncomingMessage, port: number): OriginVerdict {
  const origin = req.headers.origin;
  if (!origin) return "absent";
  return allowedOrigins(port).has(origin) ? "same-origin" : "foreign";
}

export function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  res.writeHead(status, {
    "content-length": String(payload.byteLength),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), { "content-type": "application/json; charset=utf-8" });
}

/**
 * Everything unauthorized answers 404 rather than 403: a wrong token should not
 * tell the caller that a session exists at all.
 */
export function sendNotFound(res: ServerResponse): void {
  send(res, 404, "Not found\n", { "content-type": "text/plain; charset=utf-8" });
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.byteLength;
    if (size > JSON_BODY_LIMIT) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext.toLowerCase()] ?? "application/octet-stream";
}
