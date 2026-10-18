function ipv4(host: string): [number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return null;
  return [Number(parts[0]), Number(parts[1])];
}

/** The hostname a client addressed: brackets for IPv6 literals, port stripped. */
export function requestHostname(request: Request): string {
  const host = request.headers.get("host") ?? "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return (end === -1 ? host : host.slice(0, end + 1)).toLowerCase();
  }
  const colon = host.indexOf(":");
  return (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
}

/**
 * The library answers to localhost, private-network addresses and mDNS names.
 * Anything else is a rebinding attempt: a hostile page can point its own domain
 * at 127.0.0.1, so the Host header, not the network, is what has to be checked.
 * A reverse proxy on its own hostname is allowed through BETTER_KINDLE_ALLOWED_HOSTS.
 */
export function isAllowedHost(hostname: string, allowed = process.env.BETTER_KINDLE_ALLOWED_HOSTS ?? ""): boolean {
  const host = hostname.toLowerCase();
  if (allowed.split(",").some((value) => value.trim().toLowerCase() === host)) return true;
  if (host === "localhost" || host.endsWith(".local")) return true;
  const address = ipv4(host);
  if (address) {
    const [first, second] = address;
    return first === 127 || first === 10
      || (first === 192 && second === 168)
      || (first === 172 && second >= 16 && second <= 31);
  }
  // IPv6 hostnames arrive as literals in brackets: loopback, unique-local, link-local.
  return /^\[(::1|f[cd][0-9a-f]{2}:|fe80:)/i.test(host);
}

/** Returns the 403 every library endpoint must send, or null when the host is fine. */
export function forbiddenHost(request: Request): Response | null {
  const host = requestHostname(request);
  if (isAllowedHost(host)) return null;
  return new Response(
    `This library only answers to localhost, LAN addresses and names in BETTER_KINDLE_ALLOWED_HOSTS. Host: ${host}\n`,
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
