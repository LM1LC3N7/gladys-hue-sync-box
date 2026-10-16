import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestAddress, boxesOfScan } from '../src/discovery.js';
import { MDNS_RESULTS } from './fixtures/mdns.js';

test('the Sync Boxes of an mDNS scan, one per unique id', () => {
  assert.deepEqual(boxesOfScan(MDNS_RESULTS), [
    {
      uniqueId: 'C42996000999',
      host: '192.168.1.40',
      port: 443,
      path: '/api', // an unsafe TXT path falls back to the default
      name: 'Bedroom',
      deviceType: 'HSB002',
    },
    {
      uniqueId: 'C42996000000',
      host: '192.168.1.12',
      port: 443,
      path: '/api',
      name: 'My Sync Box',
      deviceType: 'HSB001',
    },
  ]);
  assert.deepEqual(boxesOfScan(undefined), []);
  assert.deepEqual(boxesOfScan([null, { name: 42 }]), []);
});

test('IPv4 first, then a routable IPv6', () => {
  assert.equal(bestAddress(['fe80::1', '2a01:cb00::12', '192.168.1.12']), '192.168.1.12');
  assert.equal(bestAddress(['fe80::1', '2a01:cb00::12']), '2a01:cb00::12');
  assert.equal(bestAddress(['fe80::1', '::1']), undefined);
  assert.equal(bestAddress('192.168.1.12'), undefined);
});
