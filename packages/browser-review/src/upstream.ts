// SPDX-License-Identifier: Apache-2.0
import type { LookupAddress } from "node:dns";
import { lookup as systemLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHostname = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<readonly LookupAddress[]>;

export interface ResolvedUpstream {
  url: URL;
  remote: boolean;
  pinnedAddresses: readonly PinnedAddress[];
  lookup?: LookupFunction;
}

export class UpstreamError extends Error {}

function unbracket(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets;
}

function parseIpv6(address: string): number[] | null {
  const percent = address.indexOf("%");
  const withoutZone = percent === -1 ? address : address.slice(0, percent);
  const halves = withoutZone.toLowerCase().split("::");
  if (halves.length > 2) return null;

  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const words: number[] = [];
    for (const part of half.split(":")) {
      const ipv4 = parseIpv4(part);
      if (ipv4) {
        words.push((ipv4[0]! << 8) | ipv4[1]!, (ipv4[2]! << 8) | ipv4[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      words.push(Number.parseInt(part, 16));
    }
    return words;
  };

  const left = parseHalf(halves[0] ?? "");
  const right = parseHalf(halves[1] ?? "");
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function embeddedIpv4(address: string): string | null {
  const words = parseIpv6(address);
  if (!words) return null;
  if (!words.slice(0, 5).every((word) => word === 0) || (words[5] !== 0 && words[5] !== 0xffff))
    return null;
  if (words[5] === 0 && words[6] === 0 && (words[7] === 0 || words[7] === 1)) return null;
  return `${words[6]! >> 8}.${words[6]! & 0xff}.${words[7]! >> 8}.${words[7]! & 0xff}`;
}

/**
 * Return the special-use class that must never be used by a remote session.
 * RFC1918 and IPv6 ULA addresses are intentionally not on this list: private
 * staging services are a supported use case.
 */
export function unsafeRemoteAddressReason(address: string): string | null {
  const embedded = embeddedIpv4(address);
  if (embedded) return unsafeRemoteAddressReason(embedded);

  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b] = ipv4;
    if (a === 0) return "unspecified";
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link-local";
    if (a! >= 224 && a! <= 239) return "multicast";
    return null;
  }

  const ipv6 = parseIpv6(address);
  if (!ipv6) return "invalid";
  if (ipv6.every((word) => word === 0)) return "unspecified";
  if (ipv6.slice(0, 7).every((word) => word === 0) && ipv6[7] === 1) return "loopback";
  if ((ipv6[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((ipv6[0]! & 0xff00) === 0xff00) return "multicast";
  return null;
}

export interface ValidatedProxyTarget {
  url: URL;
  remote: boolean;
}

/** Validate the URL policy without doing network resolution. */
export function validateProxyTarget(raw: string, allowRemote = false): ValidatedProxyTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamError(`"${raw}" is not a URL this tool can open.`);
  }

  if (url.username || url.password) {
    throw new UpstreamError("proxy URLs must not contain a username or password");
  }

  const local = LOOPBACK_HOSTS.has(url.hostname);
  if (local) {
    if (url.protocol !== "http:") {
      throw new UpstreamError("localhost proxy URLs must use http://");
    }
    return { url, remote: false };
  }

  if (!allowRemote) {
    throw new UpstreamError(
      `"${url.hostname}" is not a local host. Pass --allow-remote only for a trusted staging origin you control.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new UpstreamError("remote proxy URLs must use https://");
  }

  const literal = unbracket(url.hostname);
  if (isIP(literal)) {
    const reason = unsafeRemoteAddressReason(literal);
    if (reason) throw new UpstreamError(`remote proxy address is ${reason} and is not allowed`);
  }
  return { url, remote: true };
}

export function createPinnedLookup(addresses: readonly PinnedAddress[]): LookupFunction {
  const pinned = addresses.map(({ address, family }) => ({ address, family }));
  return ((_hostname, options, callback) => {
    const all = typeof options === "object" && options !== null && options.all === true;
    if (all) {
      callback(null, pinned);
      return;
    }
    const first = pinned[0];
    if (!first) {
      callback(new Error("remote upstream has no pinned address"), "", 4);
      return;
    }
    callback(null, first.address, first.family);
  }) as LookupFunction;
}

/** Resolve once, reject unsafe answers, then pin the complete validated set. */
export async function resolveUpstream(
  raw: string,
  options: { allowRemote?: boolean; resolveHostname?: ResolveHostname } = {},
): Promise<ResolvedUpstream> {
  const validated = validateProxyTarget(raw, options.allowRemote);
  if (!validated.remote) {
    return { url: validated.url, remote: false, pinnedAddresses: [] };
  }

  const hostname = unbracket(validated.url.hostname);
  const family = isIP(hostname);
  const resolveHostname: ResolveHostname =
    options.resolveHostname ?? ((name, lookupOptions) => systemLookup(name, lookupOptions));
  const answers = family
    ? [{ address: hostname, family }]
    : await resolveHostname(hostname, { all: true, verbatim: true });
  if (answers.length === 0) throw new UpstreamError("remote proxy hostname returned no addresses");

  const unique = new Map<string, PinnedAddress>();
  for (const answer of answers) {
    if (answer.family !== 4 && answer.family !== 6) {
      throw new UpstreamError("remote proxy hostname returned an unsupported address family");
    }
    const reason = unsafeRemoteAddressReason(answer.address);
    if (reason) {
      throw new UpstreamError(`remote proxy hostname resolved to a ${reason} address`);
    }
    unique.set(`${answer.family}:${answer.address}`, {
      address: answer.address,
      family: answer.family,
    });
  }

  const pinnedAddresses = [...unique.values()];
  return {
    url: validated.url,
    remote: true,
    pinnedAddresses,
    lookup: createPinnedLookup(pinnedAddresses),
  };
}

export function remoteAuthorization(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (
    !/^(?:Basic [A-Za-z0-9+/]+={0,2}|Bearer [A-Za-z0-9\-._~+/]+=*)$/.test(value) ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new UpstreamError(
      "BROWSER_REVIEW_REMOTE_AUTHORIZATION must contain one Basic or Bearer credential",
    );
  }
  return value;
}
