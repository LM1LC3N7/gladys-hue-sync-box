// -----------------------------------------------------------------------------
// The raw results of the mediated mDNS scan (gladys.scanNetwork('mdns')) ->
// the Sync Boxes found (pure). The core browses `_huesync._tcp` and returns
// `{ name, host, addresses, port, txt }` per instance; a box announces
//   name "<…>._huesync._tcp.local", port 443,
//   TXT uniqueid=<12 hex>, path=/api, name=<its name>, devicetype=HSB001
// (Home Assistant's huesyncbox config flow reads the same records).
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { DEFAULT_PATH, DEFAULT_PORT, MDNS_SERVICE } from './constants.js';
import { UNIQUE_ID } from './syncbox/https.js';

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const LINK_LOCAL_V6 = /^fe[89ab][0-9a-f]:/i;

/** The address to reach a box with: IPv4 first, then a routable IPv6. */
export function bestAddress(addresses) {
  const list = (Array.isArray(addresses) ? addresses : []).filter((a) => typeof a === 'string');
  return (
    list.find((a) => IPV4.test(a)) ??
    list.find((a) => a.includes(':') && a !== '::1' && !LINK_LOCAL_V6.test(a))
  );
}

/** A TXT `path` is kept only when it is a plain absolute path ("/api"). */
const safePath = (path) =>
  typeof path === 'string' && /^\/[A-Za-z0-9_\-/]{0,40}$/.test(path) ? path : DEFAULT_PATH;

/**
 * @param {object[]} results raw mDNS scan results
 * @returns {object[]} `{ uniqueId, host, port, path, name, deviceType }` per
 *   box, one per unique id, by name
 */
export function boxesOfScan(results) {
  const found = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const full = typeof result?.name === 'string' ? result.name.replace(/\.$/, '') : '';
    if (!full.toLowerCase().endsWith(`.${MDNS_SERVICE}.local`)) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    const uniqueId = String(txt.uniqueid ?? '')
      .trim()
      .toUpperCase();
    const host = bestAddress(result.addresses);
    if (!UNIQUE_ID.test(uniqueId) || !host || found.has(uniqueId)) {
      continue;
    }
    const port = Number(result.port);
    found.set(uniqueId, {
      uniqueId,
      host,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
      path: safePath(txt.path),
      name: typeof txt.name === 'string' ? txt.name.trim().slice(0, 60) : '',
      deviceType: typeof txt.devicetype === 'string' ? txt.devicetype.trim().slice(0, 20) : '',
    });
  }
  return [...found.values()].sort((a, b) =>
    (a.name || a.uniqueId).localeCompare(b.name || b.uniqueId),
  );
}
