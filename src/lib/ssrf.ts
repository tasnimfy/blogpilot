// SSRF protections for outbound requests (WordPress / provider probes).
// Blocks localhost, private/loopback/link-local ranges, and cloud metadata
// addresses. Also blocks protocol-relative or non-http(s) schemes.

const PRIVATE_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./, // loopback
  /^10\./, // private
  /^192\.168\./, // private
  /^172\.(1[6-9]|2\d|3[01])\./, // private 172.16-31
  /^169\.254\./, // link-local incl. AWS metadata 169.254.169.254
  /^0\./, 
  /^::1$/, // ipv6 loopback
  /^fc/, // ipv6 unique local
  /^fd/,
];

export function isSafeOutboundUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname;
  if (host === "metadata.google.internal") return false;
  return !PRIVATE_PATTERNS.some((re) => re.test(host));
}

// Sanitize/validate before use; throws when unsafe.
export function assertSafeOutboundUrl(url: string, label = "URL"): void {
  if (!isSafeOutboundUrl(url)) {
    throw new Error(`${label} is not an allowed destination (SSRF guard)`);
  }
}
