// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { gzipSync } from "node:zlib";

let stateHome: string;
let pageDir: string;
let upstream: http.Server;
let upstreamPort: number;

beforeAll(async () => {
  stateHome = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-state-"));
  process.env["XDG_STATE_HOME"] = stateHome;

  pageDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-page-"));
  await fs.writeFile(
    path.join(pageDir, "page.html"),
    `<!doctype html>
<html><body>
  <h1 class="hero">Hello</h1>
</body></html>
`,
  );

  upstream = http.createServer((req, res) => {
    if (req.url === "/compressed") {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": "gzip",
        etag: '"original"',
      });
      return res.end(gzipSync("<html><body>Compressed fixture</body></html>"));
    }
    if (req.url === "/cookies") {
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "app=ok; Path=/" });
      return res.end(JSON.stringify({ cookie: req.headers.cookie ?? "" }));
    }
    if (req.url === "/go") {
      res.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/there` });
      return res.end();
    }
    if (req.url === "/data.json") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'",
    });
    res.end("<html><body><button>Buy</button></body></html>");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  upstreamPort = (upstream.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await fs.rm(stateHome, { recursive: true, force: true });
  await fs.rm(pageDir, { recursive: true, force: true });
});

const { startReviewServer } = await import("../src/server.js");
const { readSessionFile } = await import("../src/store.js");

function token() {
  return randomBytes(24).toString("base64url");
}

async function startHtmlSession() {
  const id = `T${Date.now()}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const tok = token();
  const running = await startReviewServer({
    id,
    token: tok,
    mode: "html-file",
    target: path.join(pageDir, "page.html"),
    projectDir: pageDir,
    port: 0,
  });
  const base = `http://127.0.0.1:${running.session.port}/r/${tok}`;
  return { running, base, id, origin: `http://127.0.0.1:${running.session.port}` };
}

describe("html-file mode", () => {
  it("serves the file tagged with its own source positions, plus the overlay", async () => {
    const { running, base } = await startHtmlSession();
    try {
      const html = await (await fetch(`${base}/`)).text();
      expect(html).toContain('data-review-src="page.html:3:3"');
      expect(html).toContain("__br/overlay.js");
    } finally {
      await running.close();
    }
  });

  it("answers 404 for a wrong token rather than admitting the session exists", async () => {
    const { running } = await startHtmlSession();
    try {
      const res = await fetch(`http://127.0.0.1:${running.session.port}/r/${"x".repeat(32)}/`);
      expect(res.status).toBe(404);
    } finally {
      await running.close();
    }
  });

  it("refuses a request whose Host is not loopback", async () => {
    // fetch() will not let us forge a Host header, and a Host that does not
    // name a loopback address is exactly the shape of a DNS-rebinding attempt,
    // so this one goes out over a raw socket.
    const { running } = await startHtmlSession();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: running.session.port,
            path: `/r/${running.session.token}/`,
            headers: { host: "attacker.example" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(404);
    } finally {
      await running.close();
    }
  });

  it("will not serve a file outside the page's own directory", async () => {
    const { running, base } = await startHtmlSession();
    try {
      const res = await fetch(`${base}/../../etc/passwd`);
      expect(res.status).toBe(404);
    } finally {
      await running.close();
    }
  });
});

describe("the review round trip", () => {
  it("carries a comment from the browser to an agent and the resolution back", async () => {
    const { running, base, id, origin } = await startHtmlSession();
    try {
      const socket = new WebSocket(`${base}/__br/ws`.replace("http", "ws"), { origin });
      const seen: unknown[] = [];
      await new Promise((resolve, reject) => {
        socket.on("open", resolve);
        socket.on("error", reject);
      });
      socket.on("message", (raw) => seen.push(JSON.parse(String(raw))));

      socket.send(
        JSON.stringify({
          type: "annotate",
          annotation: {
            comment: "Make the heading bigger.",
            page: { url: `${base}/`, path: "/", title: "t" },
            element: { outerHtmlHead: '<h1 class="hero" value="secret">Hello</h1>', tag: "h1" },
            sourceHints: [
              {
                kind: "loc",
                file: "page.html",
                line: 3,
                col: 3,
                confidence: 0.95,
                via: "data-review-src",
              },
            ],
          },
        }),
      );
      await new Promise((r) => setTimeout(r, 200));

      const pending = (await (await fetch(`${base}/__br/pending`)).json()) as {
        annotations: Array<{ id: string; comment: string; element: { outerHtmlHead: string } }>;
      };
      expect(pending.annotations).toHaveLength(1);
      expect(pending.annotations[0]!.comment).toBe("Make the heading bigger.");
      expect(pending.annotations[0]!.element.outerHtmlHead).not.toContain("secret");

      const annotationId = pending.annotations[0]!.id;
      const resolved = await fetch(`${base}/__br/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: annotationId,
          summary: "Bumped it to 2rem.",
          filesChanged: ["page.html"],
        }),
      });
      expect(resolved.status).toBe(200);

      await new Promise((r) => setTimeout(r, 300));
      expect(
        seen.some(
          (m) =>
            (m as { type?: string; annotation?: { status?: string } }).type === "updated" &&
            (m as { annotation?: { status?: string } }).annotation?.status === "resolved",
        ),
      ).toBe(true);

      const file = await readSessionFile(id);
      expect(file?.annotations[0]?.resolution?.summary).toBe("Bumped it to 2rem.");
      socket.close();
    } finally {
      await running.close();
    }
  });

  it("turns away a websocket from another origin", async () => {
    const { running, base } = await startHtmlSession();
    try {
      const rejected = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`${base}/__br/ws`.replace("http", "ws"), {
          origin: "http://evil.example",
        });
        socket.on("error", () => resolve(true));
        socket.on("open", () => {
          socket.close();
          resolve(false);
        });
      });
      expect(rejected).toBe(true);
    } finally {
      await running.close();
    }
  });

  it("will not let a web page reach the MCP endpoint", async () => {
    const { running, base } = await startHtmlSession();
    try {
      const res = await fetch(`${base}/__br/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://evil.example" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    } finally {
      await running.close();
    }
  });
});

describe("proxy mode", () => {
  it("injects the overlay, drops the CSP, and leaves other responses alone", async () => {
    const id = `P${Date.now()}`.toUpperCase();
    const tok = token();
    const running = await startReviewServer({
      id,
      token: tok,
      mode: "proxy",
      target: `http://localhost:${upstreamPort}`,
      projectDir: pageDir,
      port: 0,
    });
    const base = `http://127.0.0.1:${running.session.port}/r/${tok}`;
    try {
      const page = await fetch(`${base}/`);
      const html = await page.text();
      expect(html).toContain("__br/overlay.js");
      expect(page.headers.get("content-security-policy")).toBeNull();

      const compressed = await fetch(`${base}/compressed`);
      const decoded = await compressed.text();
      expect(decoded).toContain("Compressed fixture");
      expect(decoded).toContain("__br/overlay.js");
      expect(compressed.headers.get("content-encoding")).toBeNull();
      expect(compressed.headers.get("etag")).toBeNull();
      const cookies = await fetch(`${base}/cookies`, {
        headers: { cookie: "br_app_123=private; app=visible" },
      });
      expect(await cookies.json()).toEqual({ cookie: "app=visible" });
      expect(cookies.headers.get("set-cookie")).toContain("app=ok");
      expect(cookies.headers.get("set-cookie")).toContain("br_app_");
      const json = await fetch(`${base}/data.json`);
      expect(json.headers.get("content-type")).toContain("application/json");
      expect(await json.text()).toBe('{"ok":true}');

      const redirect = await fetch(`${base}/go`, { redirect: "manual" });
      expect(redirect.headers.get("location")).toBe(
        `http://127.0.0.1:${running.session.port}/r/${tok}/there`,
      );
    } finally {
      await running.close();
    }
  });
});

describe("remote proxy server boundary", () => {
  const remoteOptions = () => ({
    id: `REMOTE${Date.now()}${Math.random().toString(36).slice(2)}`.toUpperCase(),
    token: token(),
    mode: "proxy" as const,
    target: "https://staging.example.test",
    projectDir: pageDir,
    port: 0,
  });

  it("repeats opt-in, HTTPS and userinfo checks inside __serve", async () => {
    await expect(startReviewServer(remoteOptions())).rejects.toThrow(/--allow-remote/);
    await expect(
      startReviewServer({
        ...remoteOptions(),
        target: "http://staging.example.test",
        allowRemote: true,
      }),
    ).rejects.toThrow(/must use https/);
    await expect(
      startReviewServer({
        ...remoteOptions(),
        target: "https://user:secret@staging.example.test",
        allowRemote: true,
      }),
    ).rejects.toThrow(/username or password/);
  });

  it("rejects an unsafe DNS answer before opening the review server", async () => {
    await expect(
      startReviewServer({
        ...remoteOptions(),
        allowRemote: true,
        resolveHostname: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
      }),
    ).rejects.toThrow(/loopback/);
  });

  it("starts for a validated pinned set without persisting credentials or pins", async () => {
    let resolutions = 0;
    const options = remoteOptions();
    const running = await startReviewServer({
      ...options,
      allowRemote: true,
      remoteAuthorization: "Bearer memory-only-test-value",
      resolveHostname: async () => {
        resolutions += 1;
        return [
          { address: "192.0.2.40", family: 4 },
          { address: "2001:db8::40", family: 6 },
        ];
      },
    });
    try {
      expect(resolutions).toBe(1);
      const stored = await readSessionFile(options.id);
      expect(stored?.session.target).toBe("https://staging.example.test");
      const serialized = JSON.stringify(stored);
      expect(serialized).not.toContain("memory-only-test-value");
      expect(serialized).not.toContain("192.0.2.40");
      expect(serialized).not.toContain("2001:db8::40");
    } finally {
      await running.close();
    }
  });
});

it("rejects symlinks escaping the static root and malformed paths", async () => {
  const outside = path.join(stateHome, "secret.txt");
  await fs.writeFile(outside, "private fixture");
  await fs.symlink(outside, path.join(pageDir, "escape.txt"));
  const { running, base } = await startHtmlSession();
  try {
    expect((await fetch(`${base}/escape.txt`)).status).toBe(404);
    expect((await fetch(`${base}/%FF`)).status).toBe(404);
    expect((await fetch(base, { redirect: "manual" })).headers.get("location")).toMatch(/\/$/);
  } finally {
    await running.close();
  }
});

it("ignores malformed websocket messages and accepts the next valid comment", async () => {
  const { running, base, origin } = await startHtmlSession();
  const socket = new WebSocket(`${base}/__br/ws`.replace("http", "ws"), { origin });
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    for (const message of [
      "null",
      "[]",
      "{",
      '{"type":"annotate"}',
      '{"type":"annotate","annotation":null}',
      '{"type":"answer","text":{}}',
    ])
      socket.send(message);
    socket.send(JSON.stringify({ type: "annotate", annotation: { comment: "Still alive" } }));
    await expect
      .poll(async () => {
        const res = await fetch(`${base}/__br/pending`);
        return ((await res.json()) as { annotations: unknown[] }).annotations.length;
      })
      .toBe(1);
  } finally {
    socket.terminate();
    await running.close();
  }
});

it("authenticates root-relative proxy assets without exposing control routes", async () => {
  const tok = token();
  const running = await startReviewServer({
    id: `ROOT${Date.now()}`,
    token: tok,
    mode: "proxy",
    target: `http://127.0.0.1:${upstreamPort}`,
    projectDir: pageDir,
    port: 0,
  });
  const origin = `http://127.0.0.1:${running.session.port}`;
  try {
    expect((await fetch(`${origin}/data.json`)).status).toBe(404);
    const res = await fetch(`${origin}/r/${tok}/`);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly; SameSite=Strict");
    const headers = { cookie: cookie.split(";")[0]! };
    expect(await (await fetch(`${origin}/data.json`, { headers })).json()).toEqual({ ok: true });
    expect((await fetch(`${origin}/r/wrong/__br/annotations`, { headers })).status).toBe(404);
    expect(
      (
        await fetch(`${origin}/data.json`, {
          headers: { ...headers, origin: "http://foreign.example" },
        })
      ).status,
    ).toBe(404);
  } finally {
    await running.close();
  }
});

it("tunnels root-relative HMR sockets only with application authentication", async () => {
  const echo = new WebSocketServer({ server: upstream });
  echo.on("connection", (socket) => socket.on("message", (data) => socket.send(data)));
  const tok = token();
  const running = await startReviewServer({
    id: `WS${Date.now()}`,
    token: tok,
    mode: "proxy",
    target: `http://127.0.0.1:${upstreamPort}`,
    projectDir: pageDir,
    port: 0,
  });
  const origin = `http://127.0.0.1:${running.session.port}`;
  const response = await fetch(`${origin}/r/${tok}/`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const socket = new WebSocket(`${origin.replace("http", "ws")}/hmr`, {
    origin,
    headers: { cookie },
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const received = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(String(data))),
    );
    socket.send("HMR fixture");
    expect(await received).toBe("HMR fixture");
    const rejected = await new Promise<boolean>((resolve) => {
      const foreign = new WebSocket(`${origin.replace("http", "ws")}/hmr`, {
        origin: "http://foreign.example",
        headers: { cookie },
      });
      foreign.once("error", () => resolve(true));
      foreign.once("open", () => {
        foreign.terminate();
        resolve(false);
      });
    });
    expect(rejected).toBe(true);
  } finally {
    socket.terminate();
    for (const client of echo.clients) client.terminate();
    await new Promise<void>((resolve) => echo.close(() => resolve()));
    await running.close();
  }
});

it("serves MCP status and a zero-timeout wait through the actual HTTP transport", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const { running, base } = await startHtmlSession();
  const client = new Client({ name: "regression-test", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/__br/mcp`)));
    const status = await client.callTool({ name: "review_status", arguments: {} });
    expect(JSON.stringify(status)).toContain("html-file");
    const wait = await client.callTool({ name: "review_wait", arguments: { timeoutMs: 0 } });
    expect(JSON.stringify(wait)).toContain("No new annotations");
  } finally {
    await client.close();
    await running.close();
  }
});
