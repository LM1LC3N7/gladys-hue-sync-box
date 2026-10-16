import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  normalizeConfig,
  parseHost,
  parseHosts,
  parseRegistrations,
  serializeRegistrations,
} from '../src/config.js';

test('a typed address: IP, host name, port, pasted URL', () => {
  assert.deepEqual(parseHost('192.168.1.12'), { host: '192.168.1.12', port: 443 });
  assert.deepEqual(parseHost(' SyncBox.lan:8443 '), { host: 'syncbox.lan', port: 8443 });
  assert.deepEqual(parseHost('https://192.168.1.12/api/v1'), { host: '192.168.1.12', port: 443 });
  assert.deepEqual(parseHost('[fd00::12]:443'), { host: 'fd00::12', port: 443 });
  assert.deepEqual(parseHost('fd00::12'), { host: 'fd00::12', port: 443 });
  for (const bad of ['', 'http://192.168.1.12', 'user@box', 'bad_host', 'box:99999', 'a..b']) {
    assert.equal(parseHost(bad), undefined, bad);
  }
});

test('the hosts field: separators, duplicates, invalid positions', () => {
  assert.deepEqual(parseHosts('192.168.1.12, 192.168.1.12;box.lan\nftp://x  bad_host'), {
    hosts: [
      { host: '192.168.1.12', port: 443 },
      { host: 'box.lan', port: 443 },
    ],
    invalid: [4, 5],
  });
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('registrations: stored as JSON, invalid entries dropped', () => {
  const map = parseRegistrations(
    JSON.stringify({
      c42996000000: {
        host: '192.168.1.12',
        port: 443,
        path: '/api',
        token: 'secret',
        registration_id: '3',
        name: 'My Sync Box',
        device_type: 'HSB1',
      },
      C42996000001: { host: '192.168.1.13' }, // no token
      nothex: { host: '192.168.1.14', token: 't' },
      C42996000002: { host: 'bad host', token: 't' },
    }),
  );
  assert.deepEqual([...map.keys()], ['C42996000000']);
  const r = map.get('C42996000000');
  assert.deepEqual(r, {
    uniqueId: 'C42996000000',
    host: '192.168.1.12',
    port: 443,
    path: '/api',
    token: 'secret',
    registrationId: '3',
    name: 'My Sync Box',
    deviceType: 'HSB1',
  });
  assert.deepEqual(parseRegistrations(serializeRegistrations(map)), map);
  assert.equal(parseRegistrations('not json').size, 0);
  assert.equal(parseRegistrations(undefined).size, 0);
  assert.equal(parseRegistrations('[1]').size, 0);
});

test('the configuration, normalized', () => {
  const c = normalizeConfig({ hosts: 'box.lan', poll_interval: '1' });
  assert.deepEqual(c.hosts, [{ host: 'box.lan', port: 443 }]);
  assert.equal(c.pollMs, 2000); // clamped to the minimum
  assert.equal(normalizeConfig({ poll_interval: 600 }).pollMs, 60_000);
  assert.equal(normalizeConfig({}).pollMs, DEFAULTS.poll_interval * 1000);
  assert.equal(normalizeConfig(undefined).registrations.size, 0);
});
