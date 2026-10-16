// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, plus the
// registrations the integration stores itself (STORED.REGISTRATIONS, a JSON
// string outside the schema, never shown in the UI), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PATH, DEFAULT_PORT, LIMITS, STORED, TIMINGS } from './constants.js';
import { UNIQUE_ID } from './syncbox/https.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  hosts: '',
  poll_interval: TIMINGS.pollDefault,
};

export const BOUNDS = { poll_interval: { min: TIMINGS.pollMin, max: TIMINGS.pollMax } };

const number = (value, fallback, { min, max }) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * One typed address: an IP or a host name, with an optional :port; a pasted
 * URL ("https://192.168.1.12/api/v1") is reduced to its host and port.
 * @returns {{ host: string, port: number } | undefined}
 */
export function parseHost(raw) {
  let entry = String(raw ?? '').trim();
  if (!entry) {
    return undefined;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(entry);
  if (scheme && scheme[1].toLowerCase() !== 'https') {
    return undefined;
  }
  entry = entry.replace(/^https:\/\//i, '').replace(/[/?#].*$/, '');
  if (entry.includes('@')) {
    return undefined;
  }
  let host = entry;
  let port = DEFAULT_PORT;
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(entry);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] ? Number(bracketed[2]) : DEFAULT_PORT;
  } else if ((entry.match(/:/g) ?? []).length >= 2) {
    host = entry; // a bare IPv6 address
  } else {
    const withPort = /^(.+):(\d{1,5})$/.exec(entry);
    if (withPort) {
      host = withPort[1];
      port = Number(withPort[2]);
    }
    if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
      return undefined;
    }
  }
  if (!(port > 0 && port < 65536)) {
    return undefined;
  }
  return { host: host.toLowerCase(), port };
}

/**
 * The `hosts` field: addresses separated by commas, spaces or new lines.
 *   -> { hosts: [{ host, port }], invalid: [positions] }
 */
export function parseHosts(text) {
  const hosts = [];
  const invalid = [];
  const seen = new Set();
  String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .forEach((entry, index) => {
      const parsed = parseHost(entry);
      if (!parsed) {
        invalid.push(index + 1);
        return;
      }
      const key = `${parsed.host}:${parsed.port}`;
      if (!seen.has(key) && hosts.length < LIMITS.hosts) {
        seen.add(key);
        hosts.push(parsed);
      }
    });
  return { hosts, invalid };
}

const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * The stored registrations (a JSON string) -> Map uniqueId -> registration
 *   { uniqueId, host, port, path, token, registrationId, name, deviceType }
 * Entries without a valid id, address or token are dropped.
 */
export function parseRegistrations(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }
  }
  const map = new Map();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return map;
  }
  for (const [id, entry] of Object.entries(data)) {
    const uniqueId = String(id).toUpperCase();
    const target = parseHost(entry?.host);
    const token = str(entry?.token, 200);
    if (!UNIQUE_ID.test(uniqueId) || !target || !token || map.size >= LIMITS.boxes) {
      continue;
    }
    const port = Number(entry.port);
    map.set(uniqueId, {
      uniqueId,
      host: target.host,
      port: Number.isInteger(port) && port > 0 && port < 65536 ? port : target.port,
      path: /^\/[A-Za-z0-9_\-/]{0,40}$/.test(entry.path ?? '') ? entry.path : DEFAULT_PATH,
      token,
      registrationId: str(entry.registration_id, 40),
      name: str(entry.name, 60),
      deviceType: str(entry.device_type, 20),
    });
  }
  return map;
}

/** Map of registrations -> the JSON string stored with setConfig. */
export function serializeRegistrations(map) {
  const data = {};
  for (const r of map.values()) {
    data[r.uniqueId] = {
      host: r.host,
      port: r.port,
      path: r.path,
      token: r.token,
      registration_id: r.registrationId,
      name: r.name,
      device_type: r.deviceType,
    };
  }
  return JSON.stringify(data);
}

/** The whole configuration, normalized. */
export function normalizeConfig(raw = {}) {
  const c = raw ?? {};
  const { hosts, invalid } = parseHosts(c.hosts ?? DEFAULTS.hosts);
  return {
    hosts,
    invalidHosts: invalid,
    pollMs: number(c.poll_interval, DEFAULTS.poll_interval, BOUNDS.poll_interval) * 1000,
    registrations: parseRegistrations(c[STORED.REGISTRATIONS]),
  };
}
