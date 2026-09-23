// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs/promises";
import { validateHeaderValue } from "node:http";
import { domainToASCII } from "node:url";
import type { RemoteCookieJar, StoredCookie } from "./cookie-jar.js";

const MAX_COOKIE_FILE_BYTES = 1024 * 1024;
const MAX_COOKIES = 1_000;
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function containsDisallowedControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export class CookieFileError extends Error {}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export async function importCookieFile(
  file: string,
  upstream: URL,
  jar: RemoteCookieJar,
  now = Date.now(),
): Promise<number> {
  if (upstream.protocol !== "https:") {
    throw new CookieFileError("--cookie-file requires an HTTPS proxy target");
  }
  let bytes: Buffer;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new CookieFileError("cookie file is not a regular file");
    if (stat.size > MAX_COOKIE_FILE_BYTES) {
      throw new CookieFileError("cookie file exceeds the 1 MiB limit");
    }
    bytes = await fs.readFile(file);
  } catch (error) {
    if (error instanceof CookieFileError) throw error;
    throw new CookieFileError("unable to read cookie file", { cause: error });
  }
  if (bytes.byteLength > MAX_COOKIE_FILE_BYTES) {
    throw new CookieFileError("cookie file exceeds the 1 MiB limit");
  }

  const raw = bytes.toString("utf8");
  if (containsDisallowedControl(raw)) {
    throw new CookieFileError("cookie file contains a control character");
  }
  const targetHost = upstream.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const imported: Array<Omit<StoredCookie, "order">> = [];
  let count = 0;

  for (const [index, original] of raw.split(/\r?\n/).entries()) {
    let line = original;
    if (line === "" || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    count += 1;
    if (count > MAX_COOKIES)
      throw new CookieFileError("cookie file exceeds the 1,000 cookie limit");
    const fields = line.split("\t");
    if (fields.length !== 7) {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    const [rawDomain, includeRaw, cookiePath, secureRaw, expiryRaw, name, value] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const includeSubdomains = includeRaw.toUpperCase() === "TRUE";
    if (includeRaw.toUpperCase() !== "TRUE" && includeRaw.toUpperCase() !== "FALSE") {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    const secure = secureRaw.toUpperCase() === "TRUE";
    if (secureRaw.toUpperCase() !== "TRUE" && secureRaw.toUpperCase() !== "FALSE") {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    const domain = domainToASCII(rawDomain.replace(/^\./, "").toLowerCase());
    if (
      !domain ||
      !cookiePath.startsWith("/") ||
      !/^\d+$/.test(expiryRaw) ||
      !COOKIE_NAME.test(name) ||
      value.includes(";")
    ) {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    const expiresSeconds = Number(expiryRaw);
    try {
      validateHeaderValue("Cookie", value);
    } catch {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    if (!Number.isSafeInteger(expiresSeconds)) {
      throw new CookieFileError(`invalid Netscape cookie record on line ${index + 1}`);
    }
    const hostOnly = !includeSubdomains;
    const applies = hostOnly ? targetHost === domain : domainMatches(targetHost, domain);
    if (!applies) continue;
    const expiresAt = expiresSeconds === 0 ? undefined : expiresSeconds * 1000;
    if (expiresAt !== undefined && expiresAt <= now) continue;
    imported.push({
      name,
      value,
      domain,
      hostOnly,
      path: cookiePath,
      secure,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    });
  }

  jar.import(imported, now);
  return imported.length;
}
