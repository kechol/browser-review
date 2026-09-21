// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { RemoteCookieJar } from "../src/cookie-jar.js";

describe("RemoteCookieJar", () => {
  it("applies Secure, Domain and Path without exposing cookies to unrelated requests", () => {
    const jar = new RemoteCookieJar();
    const now = Date.UTC(2026, 8, 21);
    jar.store(
      [
        "root=one; Secure; Path=/",
        "admin=two; Secure; Domain=staging.example.test; Path=/admin",
        "foreign=no; Domain=other.example.test; Path=/",
      ],
      new URL("https://staging.example.test/login"),
      now,
    );
    expect(jar.header(new URL("https://staging.example.test/admin/users"), now)).toBe(
      "admin=two; root=one",
    );
    expect(jar.header(new URL("https://staging.example.test/public"), now)).toBe("root=one");
    expect(jar.header(new URL("http://staging.example.test/admin"), now)).toBeUndefined();
    expect(jar.header(new URL("https://other.example.test/admin"), now)).toBeUndefined();
  });

  it("handles expiry, logout deletion and clearing at session shutdown", () => {
    const jar = new RemoteCookieJar();
    const now = Date.UTC(2026, 8, 21);
    const url = new URL("https://staging.example.test/app/login");
    jar.store("session=active; Secure; Path=/app; Max-Age=60", url, now);
    expect(jar.header(new URL("https://staging.example.test/app"), now + 1_000)).toBe(
      "session=active",
    );
    expect(jar.header(new URL("https://staging.example.test/app"), now + 61_000)).toBeUndefined();

    jar.store("session=active; Secure; Path=/app", url, now);
    jar.store("session=; Secure; Path=/app; Max-Age=0", url, now);
    expect(jar.header(new URL("https://staging.example.test/app"), now)).toBeUndefined();

    jar.store("session=active; Secure; Path=/", url, now);
    jar.clear();
    expect(jar.header(new URL("https://staging.example.test/"), now)).toBeUndefined();
  });

  it("keeps concurrent session jars isolated", () => {
    const first = new RemoteCookieJar();
    const second = new RemoteCookieJar();
    const url = new URL("https://staging.example.test/");
    first.store("session=first; Secure; Path=/", url);
    second.store("session=second; Secure; Path=/", url);
    expect(first.header(url)).toBe("session=first");
    expect(second.header(url)).toBe("session=second");
  });
});
