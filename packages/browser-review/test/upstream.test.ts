// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  remoteAuthorization,
  resolveUpstream,
  unsafeRemoteAddressReason,
  validateProxyTarget,
  type ResolveHostname,
} from "../src/upstream.js";

describe("remote target policy", () => {
  it("keeps localhost HTTP as the default and denies remote origins without opt-in", () => {
    expect(validateProxyTarget("http://localhost:5173")).toMatchObject({ remote: false });
    expect(() => validateProxyTarget("https://staging.example.test")).toThrow(/--allow-remote/);
  });

  it("requires HTTPS and forbids credentials for an opted-in remote origin", () => {
    expect(validateProxyTarget("https://staging.example.test", true)).toMatchObject({
      remote: true,
    });
    expect(() => validateProxyTarget("http://staging.example.test", true)).toThrow(/https/);
    expect(() => validateProxyTarget("https://user:secret@staging.example.test", true)).toThrow(
      /username or password/,
    );
  });

  it.each([
    ["0.0.0.0", "unspecified"],
    ["127.0.0.1", "loopback"],
    ["169.254.10.1", "link-local"],
    ["224.0.0.1", "multicast"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::7f00:1", "loopback"],
    ["fe80::1", "link-local"],
    ["ff02::1", "multicast"],
  ])("classifies %s as %s", (address, reason) => {
    expect(unsafeRemoteAddressReason(address)).toBe(reason);
  });

  it.each(["10.1.2.3", "172.16.4.5", "192.168.1.2", "203.0.113.9", "fd00::1", "2001:db8::1"])(
    "allows the private or routable address %s",
    (address) => expect(unsafeRemoteAddressReason(address)).toBeNull(),
  );
});

describe("DNS pinning", () => {
  it("resolves once and returns only the validated startup set", async () => {
    let calls = 0;
    const resolveHostname: ResolveHostname = async () => {
      calls += 1;
      return [
        { address: "192.0.2.10", family: 4 },
        { address: "2001:db8::10", family: 6 },
        { address: "192.0.2.10", family: 4 },
      ];
    };
    const resolved = await resolveUpstream("https://staging.example.test", {
      allowRemote: true,
      resolveHostname,
    });
    expect(calls).toBe(1);
    expect(resolved.pinnedAddresses).toEqual([
      { address: "192.0.2.10", family: 4 },
      { address: "2001:db8::10", family: 6 },
    ]);

    const all = await new Promise<unknown>((resolve, reject) => {
      resolved.lookup!("staging.example.test", { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(all).toEqual(resolved.pinnedAddresses);
    expect(calls).toBe(1);
  });

  it.each(["127.0.0.1", "::ffff:127.0.0.1", "169.254.1.1", "ff02::1"])(
    "rejects a hostname whose startup answer includes %s",
    async (address) => {
      await expect(
        resolveUpstream("https://staging.example.test", {
          allowRemote: true,
          resolveHostname: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
        }),
      ).rejects.toThrow(/resolved to a .* address/);
    },
  );

  it("rejects a mixed answer instead of silently dropping the unsafe address", async () => {
    await expect(
      resolveUpstream("https://staging.example.test", {
        allowRemote: true,
        resolveHostname: async () => [
          { address: "192.0.2.20", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    ).rejects.toThrow(/loopback/);
  });
});

describe("remote authorization", () => {
  it("accepts one Basic or Bearer value without persisting it", () => {
    expect(remoteAuthorization("Basic dXNlcjpwYXNz")).toBe("Basic dXNlcjpwYXNz");
    expect(remoteAuthorization("Bearer synthetic-token")).toBe("Bearer synthetic-token");
    expect(remoteAuthorization(undefined)).toBeUndefined();
  });

  it.each(["Digest value", "Bearer value\nInjected: yes", "Basic not base64!"])(
    "rejects malformed credential %j",
    (value) => expect(() => remoteAuthorization(value)).toThrow(/Basic or Bearer/),
  );
});
