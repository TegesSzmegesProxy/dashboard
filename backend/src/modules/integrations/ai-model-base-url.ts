import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Addresses a hosted control plane must not call on a customer's behalf:
 * loopback, private, link-local, CGNAT, multicast and reserved ranges.
 * IPv4-mapped IPv6 addresses are checked against the IPv4 rules.
 */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    !host.includes('.') ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

function bareHostname(url: URL): string {
  // URL keeps IPv6 literals in brackets.
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/**
 * Validates and normalizes an organization's custom AI endpoint. Returns an
 * error message that is safe to show, or the normalized URL.
 *
 * Without `allowPrivate` only HTTPS endpoints on public hostnames or public IP
 * literals are accepted; local and private endpoints are for self-hosted
 * deployments that opt in (ADR-0017).
 */
export function normalizeAiBaseUrl(
  raw: string,
  allowPrivate: boolean,
): { ok: true; url: string } | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: 'baseUrl must be an absolute URL' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: 'baseUrl must use http or https' };
  }
  if (url.username || url.password) {
    return { ok: false, message: 'baseUrl must not contain credentials' };
  }
  if (url.search || url.hash) {
    return {
      ok: false,
      message: 'baseUrl must not contain a query or fragment',
    };
  }
  if (!allowPrivate) {
    if (url.protocol !== 'https:') {
      return { ok: false, message: 'baseUrl must use https' };
    }
    const hostname = bareHostname(url);
    if (
      isIP(hostname) === 0
        ? isLocalHostname(hostname)
        : isNonPublicAddress(hostname)
    ) {
      return {
        ok: false,
        message:
          'Local and private AI endpoints are disabled on this control plane',
      };
    }
  }
  // The SDK appends `/v1/...`, so a trailing slash would double up.
  return { ok: true, url: url.toString().replace(/\/+$/, '') };
}

/**
 * Re-checks a stored public endpoint right before use, so a hostname that
 * now resolves to a private address is not called. The SDK resolves the name
 * again, so this narrows rather than closes DNS rebinding (ADR-0017).
 */
export async function classifyEndpointAddresses(
  baseUrl: string,
): Promise<'public' | 'private' | 'unresolved'> {
  const hostname = bareHostname(new URL(baseUrl));
  if (isIP(hostname) !== 0) {
    return isNonPublicAddress(hostname) ? 'private' : 'public';
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return 'unresolved';
  }
  if (addresses.length === 0) return 'unresolved';
  return addresses.some(({ address }) => isNonPublicAddress(address))
    ? 'private'
    : 'public';
}
