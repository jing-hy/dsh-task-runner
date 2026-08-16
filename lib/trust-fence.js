// @ts-check
/**
 * dsh-task-runner — browser-trust fence for the task API routes.
 *
 * Behaviorally identical to the /api gateway's fence in
 * @deepseek-ai/dsh-client-connection and dsh-better-sidebar's trust-fence:
 * Host-header loopback or a configured trusted authority passes; cross-site
 * browser markers refuse. This is a DNS-rebinding / cross-site defense, not
 * authentication.
 *
 * @module dsh-task-runner/trust-fence
 */

/**
 * Decide whether one request may reach the plugin routes.
 * @param {{headers: Record<string, string | string[] | undefined>}} request - node request facts.
 * @param {readonly string[]} trustedHosts - non-loopback authorities this deployment serves.
 * @returns {boolean} true when the Host is ours (loopback or trusted) and browser markers are same-origin.
 */
export function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, "host");
  if (host === void 0) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === void 0) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(request.headers, "origin");
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
function header(headers, name) {
  const value = headers[name];
  return typeof value === "string" ? value : void 0;
}

/** @param {string} authority */
function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return void 0;
  }
}

/**
 * Whether a normalized URL hostname names the local loopback authority.
 * @param {string} hostname
 */
export function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * Canonical authority form: hostname, or hostname:port when a port was written.
 * @param {string} entry - trusted host entry.
 * @param {URL} entryUrl - parsed entry.
 */
function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/**
 * Whether the request authority matches a trustedHosts entry (exact or port-less).
 * @param {URL} hostUrl - the request's parsed Host URL.
 * @param {readonly string[]} trustedHosts
 */
function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === void 0) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}
