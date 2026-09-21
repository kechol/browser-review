// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { RemoteCookieJar } from "../src/cookie-jar.js";
import { proxyRequest, proxyUpgrade, rewriteLocation, type ProxyOptions } from "../src/proxy.js";
import { createPinnedLookup } from "../src/upstream.js";

const opts = {
  upstream: new URL("http://localhost:5173"),
  basePath: "/r/tok",
  selfOrigin: "http://127.0.0.1:4321",
  overlayUrl: "/r/tok/__br/overlay.js",
  overlayConfig: {},
  onWarning: () => undefined,
};

describe("rewriteLocation", () => {
  it("prefixes a relative redirect with the session path", () => {
    expect(rewriteLocation("/login", opts)).toBe("/r/tok/login");
  });

  it("follows the upstream even when it answers on a different loopback name", () => {
    expect(rewriteLocation("http://127.0.0.1:5173/app", opts)).toBe(
      "http://127.0.0.1:4321/r/tok/app",
    );
  });

  it("keeps the query and fragment", () => {
    expect(rewriteLocation("http://localhost:5173/app?a=1#b", opts)).toBe(
      "http://127.0.0.1:4321/r/tok/app?a=1#b",
    );
  });

  it("leaves a redirect to somewhere else alone", () => {
    expect(rewriteLocation("https://accounts.example.com/oauth", opts)).toBe(
      "https://accounts.example.com/oauth",
    );
  });

  it("leaves a redirect to a different local port alone", () => {
    expect(rewriteLocation("http://localhost:9999/x", opts)).toBe("http://localhost:9999/x");
  });

  it("does not throw on a malformed header", () => {
    expect(rewriteLocation("::::", opts)).toBe("::::");
  });
});

it("distinguishes protocol-relative redirects from absolute paths", () => {
  expect(rewriteLocation("//localhost:5173/app", opts)).toBe("http://127.0.0.1:4321/r/tok/app");
  expect(rewriteLocation("//example.com/app", opts)).toBe("//example.com/app");
});

describe("remote HTTPS and WSS proxy boundaries", () => {
  let fixtureDir: string;
  let ca: string;
  let key: string;
  let cert: string;
  let upstream: https.Server;
  let upstreamPort: number;
  let websocketServer: WebSocketServer;
  const requests: Array<{ url: string; headers: http.IncomingHttpHeaders; servername?: string }> =
    [];

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "browser-review-tls-"));
    const caKeyPath = path.join(fixtureDir, "ca-key.pem");
    const caPath = path.join(fixtureDir, "ca.pem");
    const keyPath = path.join(fixtureDir, "server-key.pem");
    const csrPath = path.join(fixtureDir, "server.csr");
    const certPath = path.join(fixtureDir, "server.pem");
    const extensionsPath = path.join(fixtureDir, "extensions.cnf");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        caKeyPath,
        "-out",
        caPath,
        "-subj",
        "/CN=browser-review synthetic test CA",
        "-days",
        "1",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        csrPath,
        "-subj",
        "/CN=staging.example.test",
      ],
      { stdio: "ignore" },
    );
    await fs.writeFile(extensionsPath, "subjectAltName=DNS:staging.example.test\n");
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csrPath,
        "-CA",
        caPath,
        "-CAkey",
        caKeyPath,
        "-CAcreateserial",
        "-out",
        certPath,
        "-days",
        "1",
        "-sha256",
        "-extfile",
        extensionsPath,
      ],
      { stdio: "ignore" },
    );
    [ca, key, cert] = await Promise.all([
      fs.readFile(caPath, "utf8"),
      fs.readFile(keyPath, "utf8"),
      fs.readFile(certPath, "utf8"),
    ]);

    upstream = https.createServer({ key, cert }, (req, res) => {
      requests.push({
        url: req.url ?? "/",
        headers: req.headers,
        servername: (req.socket as { servername?: string }).servername,
      });
      if (req.url === "/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "session=alpha; Secure; Path=/; HttpOnly",
          "www-authenticate": 'Basic realm="synthetic"',
          "clear-site-data": '"cookies"',
          nel: '{"report_to":"default"}',
          "report-to": '{"group":"default"}',
          "reporting-endpoints": 'default="https://reports.example.test"',
        });
        return res.end('{"loggedIn":true}');
      }
      if (req.url === "/logout") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": "session=; Secure; Path=/; Max-Age=0",
        });
        return res.end('{"loggedOut":true}');
      }
      if (req.url === "/same-redirect") {
        res.writeHead(302, {
          location: `https://staging.example.test:${upstreamPort}/account`,
        });
        return res.end();
      }
      if (req.url === "/cross-redirect") {
        res.writeHead(302, { location: "https://accounts.example.test/login" });
        return res.end();
      }
      if (req.url === "/cross-relative-redirect") {
        res.writeHead(307, { location: "//accounts.example.test/login?next=app#continue" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? "" }));
    });
    websocketServer = new WebSocketServer({ server: upstream });
    websocketServer.on("headers", (headers) => {
      headers.push("Set-Cookie: socket=ready; Secure; Path=/");
      headers.push('WWW-Authenticate: Basic realm="synthetic"');
      headers.push('Clear-Site-Data: "cookies"');
    });
    websocketServer.on("connection", (socket, req) => {
      requests.push({
        url: req.url ?? "/",
        headers: req.headers,
        servername: (req.socket as { servername?: string }).servername,
      });
      socket.on("message", (message) => socket.send(message));
    });
    upstreamPort = await listen(upstream);
  });

  beforeEach(() => requests.splice(0));

  afterAll(async () => {
    for (const client of websocketServer.clients) client.terminate();
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await close(upstream);
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  function makeOptions(overrides: Partial<ProxyOptions> = {}): ProxyOptions {
    return {
      upstream: new URL(`https://staging.example.test:${upstreamPort}`),
      remote: true,
      lookup: createPinnedLookup([{ address: "127.0.0.1", family: 4 }]),
      cookieJar: new RemoteCookieJar(),
      authorization: "Bearer session-one",
      tlsCa: ca,
      basePath: "/r/synthetic-token",
      selfOrigin: "http://127.0.0.1",
      overlayUrl: "/r/synthetic-token/__br/overlay.js",
      overlayConfig: {},
      onWarning: () => undefined,
      ...overrides,
    };
  }

  async function startProxy(options: ProxyOptions) {
    const server = http.createServer((req, res) => {
      proxyRequest(req, res, req.url ?? "/", options);
    });
    server.on("upgrade", (req, socket, head) => {
      proxyUpgrade(req, socket, head, req.url ?? "/", options);
    });
    const port = await listen(server);
    const origin = `http://127.0.0.1:${port}`;
    options.selfOrigin = origin;
    return { server, origin };
  }

  it("uses the original Host/SNI while stripping browser credentials and response state", async () => {
    const options = makeOptions();
    const review = await startProxy(options);
    try {
      const login = await fetch(`${review.origin}/login`);
      expect(await login.json()).toEqual({ loggedIn: true });
      expect(requests.at(-1)!.headers.origin).toBeUndefined();
      for (const name of [
        "set-cookie",
        "www-authenticate",
        "clear-site-data",
        "nel",
        "report-to",
        "reporting-endpoints",
      ]) {
        expect(login.headers.get(name)).toBeNull();
      }
      expect(login.headers.get("referrer-policy")).toBe("no-referrer");

      const account = await fetch(`${review.origin}/account`, {
        headers: {
          authorization: "Bearer browser-ambient",
          cookie: "browser=ambient",
          forwarded: "for=192.0.2.99",
          referer: `${review.origin}/r/synthetic-token/private`,
          origin: review.origin,
          "x-forwarded-for": "192.0.2.99",
          "x-real-ip": "192.0.2.99",
        },
      });
      expect(await account.json()).toEqual({ cookie: "session=alpha" });
      const received = requests.at(-1)!;
      expect(received.headers.authorization).toBe("Bearer session-one");
      expect(received.headers.cookie).toBe("session=alpha");
      expect(received.headers.origin).toBe(`https://staging.example.test:${upstreamPort}`);
      expect(received.headers.host).toBe(`staging.example.test:${upstreamPort}`);
      expect(received.servername).toBe("staging.example.test");
      expect(received.headers.referer).toBeUndefined();
      expect(received.headers.forwarded).toBeUndefined();
      expect(received.headers["x-forwarded-for"]).toBeUndefined();
      expect(received.headers["x-real-ip"]).toBeUndefined();
    } finally {
      await close(review.server);
    }
  });

  it("isolates credentials and cookies between sessions and honors logout", async () => {
    const firstOptions = makeOptions({ authorization: "Bearer first" });
    const secondOptions = makeOptions({ authorization: "Basic c2Vjb25kOnBhc3M=" });
    const first = await startProxy(firstOptions);
    const second = await startProxy(secondOptions);
    try {
      await fetch(`${first.origin}/login`);
      await fetch(`${second.origin}/account`);
      await fetch(`${first.origin}/account`);
      expect(requests.at(-2)!.headers.authorization).toBe("Basic c2Vjb25kOnBhc3M=");
      expect(requests.at(-2)!.headers.cookie).toBeUndefined();
      expect(requests.at(-1)!.headers.authorization).toBe("Bearer first");
      expect(requests.at(-1)!.headers.cookie).toBe("session=alpha");

      await fetch(`${first.origin}/logout`);
      await fetch(`${first.origin}/account`);
      expect(requests.at(-1)!.headers.cookie).toBeUndefined();
    } finally {
      await Promise.all([close(first.server), close(second.server)]);
    }
  });

  it("rewrites exact-origin redirects and leaves cross-origin redirects outside the proxy", async () => {
    const options = makeOptions();
    const review = await startProxy(options);
    try {
      const same = await fetch(`${review.origin}/same-redirect`, { redirect: "manual" });
      expect(same.headers.get("location")).toBe(`${review.origin}/r/synthetic-token/account`);
      const cross = await fetch(`${review.origin}/cross-redirect`, { redirect: "manual" });
      expect(cross.headers.get("location")).toBe("https://accounts.example.test/login");
      const relative = await fetch(`${review.origin}/cross-relative-redirect`, {
        method: "POST",
        body: "synthetic-body",
        redirect: "manual",
      });
      expect(relative.status).toBe(307);
      expect(relative.headers.get("location")).toBe(
        "https://accounts.example.test/login?next=app#continue",
      );
    } finally {
      await close(review.server);
    }
  });

  it("trusts the synthetic CA but rejects an untrusted issuer and hostname mismatch", async () => {
    const trusted = await startProxy(makeOptions());
    const untrusted = await startProxy(makeOptions({ tlsCa: undefined }));
    const mismatch = await startProxy(
      makeOptions({ upstream: new URL(`https://wrong.example.test:${upstreamPort}`) }),
    );
    try {
      expect((await fetch(`${trusted.origin}/account`)).status).toBe(200);
      expect((await fetch(`${untrusted.origin}/account`)).status).toBe(502);
      expect((await fetch(`${mismatch.origin}/account`)).status).toBe(502);
    } finally {
      await Promise.all([close(trusted.server), close(untrusted.server), close(mismatch.server)]);
    }
  });

  it("filters WebSocket 101 state and stores its cookie only in the session jar", async () => {
    const options = makeOptions();
    const review = await startProxy(options);
    const socket = new WebSocket(`${review.origin.replace("http", "ws")}/socket`, {
      origin: review.origin,
      headers: {
        authorization: "Bearer browser-ambient",
        cookie: "browser=ambient",
        referer: `${review.origin}/r/synthetic-token/private`,
      },
    });
    let upgradeHeaders: http.IncomingHttpHeaders | undefined;
    socket.once("upgrade", (response) => {
      upgradeHeaders = response.headers;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      expect(upgradeHeaders?.["set-cookie"]).toBeUndefined();
      expect(upgradeHeaders?.["www-authenticate"]).toBeUndefined();
      expect(upgradeHeaders?.["clear-site-data"]).toBeUndefined();
      const handshake = requests.at(-1)!;
      expect(handshake.headers.authorization).toBe("Bearer session-one");
      expect(handshake.headers.cookie).toBeUndefined();
      expect(handshake.headers.referer).toBeUndefined();
      expect(handshake.headers.origin).toBe(`https://staging.example.test:${upstreamPort}`);

      const account = await fetch(`${review.origin}/account`);
      expect(await account.json()).toEqual({ cookie: "socket=ready" });
    } finally {
      socket.terminate();
      await close(review.server);
    }
  });
});

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function close(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
