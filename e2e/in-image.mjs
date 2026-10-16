// -----------------------------------------------------------------------------
// End-to-end check run INSIDE the integration image (read-only rootfs,
// 256 MB, 0.5 CPU): the real app, its real HTTPS transport (trusting the test
// CA instead of the Sync Box root CA, the only difference) and its real poll
// loop, against the fake box container, with the SDK's fake Gladys standing
// in for Gladys. Prints one line per check; exits 1 on the first failure.
// -----------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SyncBoxApp } from '/app/src/app.js';
import { registerHandlers } from '/app/src/handlers.js';
import { createHttpsTransport } from '/app/src/syncbox/https.js';

const NAME = process.env.BOX_HOST ?? 'syncbox-fake';
const { address } = await lookup(NAME, { family: 4 });
const control = (path) => fetch(`http://${address}:8080${path}`).then((r) => r.json());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`timed out: ${what}`);
}
const ok = (line) => console.log(`ok - ${line}`);

const gladys = createFakeGladys({
  selector: 'hue-sync-box',
  config: { hosts: '', poll_interval: 2 },
  scanResults: {
    mdns: [
      {
        name: 'HueSyncBox-C42996000000._huesync._tcp.local',
        addresses: [address],
        port: 443,
        txt: ['uniqueid=C42996000000', 'path=/api', 'name=My Sync Box', 'devicetype=HSB001'],
      },
    ],
  },
});
const app = new SyncBoxApp({
  gladys,
  transport: createHttpsTransport({ ca: readFileSync('/app/e2e-tls/ca.pem') }),
  logger: { debug() {}, info() {}, warn: console.warn, error: console.error },
});
registerHandlers(gladys, app, console);
await gladys.connect();
assert.equal(gladys.fake.connectionStatus.connected, false);
ok('started without registration: "No Sync Box registered yet"');

const t0 = Date.now();
const registering = gladys.fake.action('register', {});
await wait(2500);
await control('/press');
const ack = await registering;
assert.match(ack.data.message.en, /^Registered: My Sync Box/);
ok(
  `registered over HTTPS once the button was pressed (${Date.now() - t0} ms): ${ack.data.message.en}`,
);
const stored = JSON.parse(gladys.fake.config.registrations);
assert.ok(stored.C42996000000.token, 'token stored with setConfig');
ok('token stored with setConfig, outside the config_schema');

const [device] = gladys.fake.discoveredDevices;
assert.equal(device.external_id, 'ext:hue-sync-box:box:C42996000000');
await gladys.fake.deviceCreated(device);
const f = (key) => `${device.external_id}:${key}`;
await until(() => gladys.fake.lastState(f('mode')) === 'powersave', 'first states');
ok(`device ${device.name}: ${device.features.length} features, mode powersave`);

let result = await gladys.fake.setValue(device, { external_id: f('sync') }, 1);
assert.equal(result.success, true);
await until(() => gladys.fake.lastState(f('mode')) === 'video', 'sync on read back');
ok('command: light sync on -> mode video, read back');

await control('/set?mode=passthrough');
await wait(16_000); // the quiet window after a command made through Gladys
await control('/set?mode=music');
await until(() => gladys.fake.lastState(f('mode')) === 'music', 'external change');
await until(() => gladys.fake.sceneEvents.length > 0, 'scene event');
assert.equal(gladys.fake.sceneEvents.at(-1).key, 'mode_changed');
ok(`external change seen by polling: ${JSON.stringify(gladys.fake.sceneEvents.at(-1).data)}`);

result = await gladys.fake.sceneAction('start_sync', {
  box: device.external_id,
  mode: 'game',
  input: 'input2',
  intensity: 'intense',
});
assert.deepEqual(result.data.outputs, { mode: 'game', input: 'input2', input_name: 'Gaming' });
ok('scene action start_sync: game on Gaming (HDMI 2)');

await control('/down');
await until(
  () => gladys.fake.transports.at(-1)?.transport === 'unreachable',
  'offline after three failed reads',
  20_000,
);
ok('box down: unreachable after three failed reads');
await control('/up');
await until(() => gladys.fake.transports.at(-1)?.transport === 'local', 'back online', 20_000);
ok('box up: local again');

const requests = await control('/requests');
console.log(`${requests.length} API requests in total`);
console.log(`rss MB: ${Math.round(process.memoryUsage().rss / 1048576)}`);
app.close();
await gladys.disconnect();
ok('stopped cleanly');
