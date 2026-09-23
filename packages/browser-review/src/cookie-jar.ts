// SPDX-License-Identifier: Apache-2.0

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt?: number;
  order: number;
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/") || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

/** A small RFC 6265 cookie jar scoped to one explicit HTTPS upstream origin. */
export class RemoteCookieJar {
  readonly #cookies: StoredCookie[] = [];
  #nextOrder = 0;

  constructor(readonly origin?: URL) {}

  store(
    setCookie: string | readonly string[] | undefined,
    requestUrl: URL,
    now = Date.now(),
  ): void {
    if (!this.#accepts(requestUrl)) return;
    if (!setCookie) return;
    for (const header of typeof setCookie === "string" ? [setCookie] : setCookie) {
      this.#storeOne(header, requestUrl, now);
    }
    this.#removeExpired(now);
  }

  header(requestUrl: URL, now = Date.now()): string | undefined {
    if (!this.#accepts(requestUrl)) return undefined;
    this.#removeExpired(now);
    const hostname = requestUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const pathname = requestUrl.pathname || "/";
    const values = this.#cookies
      .filter(
        (cookie) =>
          (cookie.hostOnly ? hostname === cookie.domain : domainMatches(hostname, cookie.domain)) &&
          pathMatches(pathname, cookie.path) &&
          (!cookie.secure || requestUrl.protocol === "https:"),
      )
      .toSorted((a, b) => b.path.length - a.path.length || a.order - b.order)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    return values.length > 0 ? values.join("; ") : undefined;
  }

  clear(): void {
    this.#cookies.length = 0;
  }

  import(cookies: readonly Omit<StoredCookie, "order">[], now = Date.now()): void {
    for (const cookie of cookies) {
      if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) continue;
      const existing = this.#cookies.findIndex(
        (current) =>
          current.name === cookie.name &&
          current.domain === cookie.domain &&
          current.path === cookie.path,
      );
      const next = {
        ...cookie,
        order: existing === -1 ? this.#nextOrder++ : this.#cookies[existing]!.order,
      };
      if (existing === -1) this.#cookies.push(next);
      else this.#cookies[existing] = next;
    }
  }

  #accepts(requestUrl: URL): boolean {
    return !this.origin || requestUrl.origin === this.origin.origin;
  }

  #storeOne(header: string, requestUrl: URL, now: number): void {
    const parts = header.split(";");
    const pair = parts.shift()?.trim() ?? "";
    const equals = pair.indexOf("=");
    if (equals <= 0) return;
    const name = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1).trim();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return;

    const requestHost = requestUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    let domain = requestHost;
    let hostOnly = true;
    let cookiePath = defaultPath(requestUrl.pathname);
    let secure = false;
    let expiresAt: number | undefined;
    let maxAge: number | undefined;

    for (const rawAttribute of parts) {
      const attribute = rawAttribute.trim();
      const separator = attribute.indexOf("=");
      const key = (separator === -1 ? attribute : attribute.slice(0, separator)).toLowerCase();
      const attributeValue = separator === -1 ? "" : attribute.slice(separator + 1).trim();
      if (key === "domain") {
        const candidate = attributeValue.toLowerCase().replace(/^\./, "");
        if (!candidate || !domainMatches(requestHost, candidate)) return;
        domain = candidate;
        hostOnly = false;
      } else if (key === "path" && attributeValue.startsWith("/")) {
        cookiePath = attributeValue;
      } else if (key === "secure") {
        secure = true;
      } else if (key === "max-age" && /^-?\d+$/.test(attributeValue)) {
        maxAge = Number(attributeValue);
      } else if (key === "expires") {
        const parsed = Date.parse(attributeValue);
        if (Number.isFinite(parsed)) expiresAt = parsed;
      }
    }

    if (maxAge !== undefined) {
      expiresAt = maxAge <= 0 ? 0 : now + maxAge * 1000;
    }
    const existing = this.#cookies.findIndex(
      (cookie) => cookie.name === name && cookie.domain === domain && cookie.path === cookiePath,
    );
    if (expiresAt !== undefined && expiresAt <= now) {
      if (existing !== -1) this.#cookies.splice(existing, 1);
      return;
    }

    const cookie: StoredCookie = {
      name,
      value,
      domain,
      hostOnly,
      path: cookiePath,
      secure,
      ...(expiresAt === undefined ? {} : { expiresAt }),
      order: existing === -1 ? this.#nextOrder++ : this.#cookies[existing]!.order,
    };
    if (existing === -1) this.#cookies.push(cookie);
    else this.#cookies[existing] = cookie;
  }

  #removeExpired(now: number): void {
    for (let index = this.#cookies.length - 1; index >= 0; index -= 1) {
      const expiresAt = this.#cookies[index]!.expiresAt;
      if (expiresAt !== undefined && expiresAt <= now) this.#cookies.splice(index, 1);
    }
  }
}
