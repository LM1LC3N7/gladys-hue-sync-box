// The app with its real wiring (src/handlers.js), the SDK's fake Gladys,
// fake boxes behind the client's transport, and manual timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SyncBoxApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { FakeBox, fakeTransport, fixture } from './helpers/fakeBox.js';
import { fakeTimers, settle } from './helpers/fakeTimers.js';
import { MDNS_RESULTS } from './fixtures/mdns.js';

const HOST = '192.168.1.12';
const ID = 'C42996000000';
const DEVICE = `ext:hs:box:${ID}`;
const f = (key) => `${DEVICE}:${key}`;

const registration = (extra = {}) => ({
  [ID]: {
    host: HOST,
    port: 443,
    path: '/api',
    token: 'token-1',
    registration_id: '1',
    name: 'My Sync Box',
    device_type: 'HSB1',
    ...extra,
  },
});

const silent = { debug() {}, info() {}, warn() {}, error() {} };

async function setup({
  boxes,
  registrations = registration(),
  config = {},
  mdns,
  created = true,
} = {}) {
  const box = new FakeBox();
  const transport = fakeTransport(boxes ?? { [HOST]: box });
  const timers = fakeTimers();
  const gladys = createFakeGladys({
    selector: 'hs',
    config: {
      hosts: '',
      poll_interval: 5,
      ...(registrations ? { registrations: JSON.stringify(registrations) } : {}),
      ...config,
    },
    scanResults: mdns ? { mdns } : {},
  });
  const app = new SyncBoxApp({
    gladys,
    logger: silent,
    transport,
    timers,
    now: timers.now,
    sleep: timers.sleep,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  let device;
  if (created && gladys.fake.discoveredDevices.length > 0) {
    device = gladys.fake.discoveredDevices[0];
    await gladys.fake.deviceCreated(device);
    await timers.advance(0);
  }
  return { gladys, app, box, transport, timers, device };
}

const stored = (gladys) => JSON.parse(gladys.fake.config.registrations);
const lastEvent = (gladys) => gladys.fake.sceneEvents.at(-1);

test('start: the registered box is read and published, with its inputs and areas', async () => {
  const { gladys } = await setup({ created: false });
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, 'My Sync Box');
  const input = device.features.find((x) => x.external_id === f('hdmi_input'));
  assert.equal(input.supported_options[1].label, 'Gaming (HDMI 2)');
  const area = device.features.find((x) => x.external_id === f('entertainment_area'));
  assert.equal(area.supported_options.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /registered: open Discovery/);
  await gladys.disconnect();
});

test('a created box: states published, then only what changed, with a scene event', async () => {
  const { gladys, box, timers } = await setup();
  assert.equal(gladys.fake.lastState(f('power')), 0);
  assert.equal(gladys.fake.lastState(f('mode')), 'powersave');
  assert.equal(gladys.fake.lastState(f('brightness')), 61);
  assert.equal(gladys.fake.lastState(f('hdmi_input')), 'input1');
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /1 Sync Box answers/);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first reading only arms');

  const before = gladys.fake.states.length;
  await timers.advance(5000); // nothing changed
  assert.equal(gladys.fake.states.length, before);

  box.set({ mode: 'video' }); // the Hue Sync app starts the sync
  await timers.advance(5000);
  assert.equal(gladys.fake.lastState(f('mode')), 'video');
  assert.equal(gladys.fake.lastState(f('sync')), 1);
  assert.equal(gladys.fake.lastState(f('power')), 1);
  assert.equal(gladys.fake.states.length, before + 3);
  assert.deepEqual(lastEvent(gladys), {
    key: 'mode_changed',
    data: {
      box: DEVICE,
      box_name: 'My Sync Box',
      input: 'input1',
      input_name: 'HDMI 1',
      mode: 'video',
      previous_mode: 'powersave',
      syncing: true,
    },
  });

  box.set({ hdmiSource: 'input2' }); // a console turns on
  await timers.advance(5000);
  assert.equal(lastEvent(gladys).key, 'input_changed');
  assert.equal(lastEvent(gladys).data.input_name, 'Gaming');
  await gladys.disconnect();
});

test('commands from Gladys: every feature, then read back, without scene events', async () => {
  const { gladys, box, timers, device } = await setup();
  const set = async (key, value) => {
    const ack = await gladys.fake.setValue(device, { external_id: f(key) }, value);
    await timers.advance(1000);
    return ack;
  };
  assert.equal((await set('power', 1)).success, true);
  assert.equal(box.execution.mode, 'passthrough');
  assert.equal(gladys.fake.lastState(f('power')), 1);

  await set('sync', 1);
  assert.equal(box.execution.mode, 'video'); // the last sync mode
  const puts = () => box.requests.filter((r) => r.method === 'PUT').length;
  const count = puts();
  await set('power', 1); // already on: the sync is left alone
  assert.equal(puts(), count);
  assert.equal(box.execution.mode, 'video');

  await set('mode', 'music');
  assert.equal(box.execution.mode, 'music');
  assert.equal(gladys.fake.lastState(f('mode')), 'music');
  await set('intensity_game', 'subtle');
  assert.equal(box.execution.game.intensity, 'subtle');
  assert.equal(gladys.fake.lastState(f('intensity_game')), 'subtle');
  await set('brightness', 75);
  assert.equal(box.execution.brightness, 150);
  assert.equal(gladys.fake.lastState(f('brightness')), 75);
  await set('hdmi_input', 'input4');
  assert.equal(box.execution.hdmiSource, 'input4');
  await set('entertainment_area', 'f7bd7dcb-bbcb-4cd1-b343-126e60575884');
  assert.equal(box.execution.hueTarget, 'f7bd7dcb-bbcb-4cd1-b343-126e60575884');
  await set('sync', 0);
  assert.equal(box.execution.mode, 'passthrough');
  await set('power', 0);
  assert.equal(box.execution.mode, 'powersave');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'changes made through Gladys are silent');

  // A change from the box itself after the quiet window fires again.
  await timers.advance(20_000);
  box.set({ mode: 'game' });
  await timers.advance(5000);
  assert.equal(lastEvent(gladys)?.data.mode, 'game');

  for (const [key, value] of [
    ['mode', 'disco'],
    ['intensity_video', 'max'],
    ['brightness', 120],
    ['hdmi_input', 'input7'],
    ['entertainment_area', 'Kitchen'],
    ['nope', 1],
  ]) {
    const ack = await set(key, value);
    assert.equal(ack.success, false, `${key}=${value}`);
  }
  const unknown = await gladys.fake.setValue(
    { external_id: 'ext:hs:box:C42996000999' },
    { external_id: 'ext:hs:box:C42996000999:sync' },
    1,
  );
  assert.match(unknown.error, /not registered/);
  await gladys.disconnect();
});

test('an area streamed by another application is freed, as Home Assistant does', async () => {
  const { gladys, box, timers, device } = await setup();
  const area = 'db7dd240-d061-48bf-84c2-01f086e4bfae';
  box.state.hue.groups[area].active = true;
  box.state.hue.groups[area].owner = 'Hue Sync PC';
  box.busy = { groupId: area };
  await timers.advance(5000);
  const ack = await gladys.fake.setValue(device, { external_id: f('sync') }, 1);
  assert.equal(ack.success, true);
  assert.equal(box.execution.mode, 'video');
  assert.deepEqual(
    box.requests.filter((r) => r.method === 'PUT').map((r) => r.resource),
    ['/execution', `/hue/groups/${area}`, '/execution'],
  );
  // Busy with nothing to free (the bridge is not connected): a clear error.
  box.set({ mode: 'passthrough' });
  box.busy = { groupId: 'none' };
  await timers.advance(5000);
  const busy = await gladys.fake.setValue(device, { external_id: f('sync') }, 1);
  assert.equal(busy.success, false);
  assert.match(busy.error, /entertainment area is busy/);
  await gladys.disconnect();
});

test('Register: found by mDNS, registered once the button is pressed, token stored', async () => {
  const box = new FakeBox();
  const { gladys } = await setup({
    boxes: { [HOST]: box },
    registrations: null,
    mdns: MDNS_RESULTS,
  });
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No Sync Box registered/);
  const original = box.handle.bind(box);
  let attempts = 0;
  box.handle = (request) => {
    if (request.method === 'POST' && ++attempts === 3) {
      box.pressButton(); // the user holds the button during the third second
    }
    return original(request);
  };
  const ack = await gladys.fake.action('register', {});
  assert.equal(ack.success, true);
  const message = ack.data.message;
  assert.match(message.en, /^Registered: My Sync Box \(192\.168\.1\.12\)\. Open Discovery/);
  assert.match(message.fr, /Ouvrez Découverte/);
  // The other box of the scan (C42996000999 at .40) does not answer.
  assert.match(message.en, /No button press seen on Bedroom \(192\.168\.1\.40\)/);
  assert.equal(attempts, 3);
  assert.equal(stored(gladys)[ID].token, 'token-2');
  assert.equal(stored(gladys)[ID].host, HOST);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, DEVICE);
  // Registering again: already done.
  const again = await gladys.fake.action('register', { address: HOST });
  assert.match(again.data.message.en, /Already registered: My Sync Box/);
  await gladys.disconnect();
});

test('Register by address: the id comes from the certificate; nobody presses', async () => {
  const box = new FakeBox();
  const { gladys } = await setup({ boxes: { '192.168.1.50': box }, registrations: null });
  const ack = await gladys.fake.action('register', { address: 'https://192.168.1.50/' });
  assert.match(ack.data.message.en, /No button press seen on C42996000000 \(192\.168\.1\.50\)/);
  const posts = box.requests.filter((r) => r.method === 'POST').length;
  assert.ok(posts >= 80 && posts <= 95, `${posts} attempts in the 90 s window`);
  assert.equal(gladys.fake.config.registrations, undefined);

  box.pressButton();
  const ok = await gladys.fake.action('register', { address: '192.168.1.50' });
  assert.match(ok.data.message.en, /^Registered: My Sync Box \(192\.168\.1\.50\)/);
  assert.equal(stored(gladys)[ID].host, '192.168.1.50');

  const bad = await gladys.fake.action('register', { address: 'ftp://x' });
  assert.match(bad.data.message.en, /not valid/);
  const none = await gladys.fake.action('register', { address: '192.168.1.99' });
  assert.match(none.data.message.en, /No Sync Box found/);
  await gladys.disconnect();
});

test('Discovery: a registered box found at a new address follows it', async () => {
  const box = new FakeBox();
  const moved = MDNS_RESULTS.map((r) => ({
    ...r,
    addresses: r.addresses.map((a) => (a === HOST ? '192.168.1.77' : a)),
  }));
  const { gladys, timers } = await setup({
    boxes: { '192.168.1.77': box },
    mdns: moved,
    created: false,
  });
  assert.equal(gladys.fake.discoveredDevices[0].params[0].value, HOST);
  await gladys.fake.scanRequest();
  assert.equal(stored(gladys)[ID].host, '192.168.1.77');
  assert.equal(gladys.fake.discoveredDevices[0].params[0].value, '192.168.1.77');
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await timers.advance(0);
  assert.equal(gladys.fake.lastState(f('mode')), 'powersave');
  await gladys.disconnect();
});

test('offline after three failed reads, back online, then a new address by mDNS', async () => {
  const box = new FakeBox();
  const { gladys, transport, timers } = await setup({ boxes: { [HOST]: box } });
  transport.down.add(HOST);
  await timers.advance(10_000);
  assert.notEqual(gladys.fake.transports.at(-1).transport, 'unreachable', 'two failures');
  await timers.advance(5000);
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Not answering: My Sync Box/);
  transport.down.delete(HOST);
  await timers.advance(5000);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  assert.equal(gladys.fake.connectionStatus.connected, true);

  // DHCP: the box moved; the rediscovery (mDNS, at most every 5 minutes, the
  // first outage used one) finds it at its new address.
  await timers.advance(5 * 60_000);
  transport.boxes['192.168.1.77'] = box;
  transport.down.add(HOST);
  gladys.fake.scanResults.mdns = MDNS_RESULTS.map((r) => ({
    ...r,
    addresses: r.addresses.map((a) => (a === HOST ? '192.168.1.77' : a)),
  }));
  await timers.advance(15_000);
  await settle();
  assert.equal(stored(gladys)[ID].host, '192.168.1.77');
  await timers.advance(1000);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
  await gladys.disconnect();
});

test('a refused token: told in the status, read slowly until a new registration', async () => {
  const { gladys, box, timers } = await setup();
  box.tokens.clear();
  await timers.advance(5000);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /Registration refused by My Sync Box/);
  const reads = box.requests.length;
  await timers.advance(30_000);
  assert.equal(box.requests.length, reads, 'no read before a minute');
  await timers.advance(30_000);
  assert.equal(box.requests.length, reads + 1);
  const test = await gladys.fake.action('test_connection', {});
  assert.match(test.data.message.en, /refused the token, register it again/);
  await gladys.disconnect();
});

test('scene actions: start, switch input, read, stop', async () => {
  const { gladys, box, timers, device } = await setup();
  let ack = await gladys.fake.sceneAction('start_sync', {
    box: device.external_id,
    mode: 'game',
    intensity: 'intense',
    input: 'input2',
    brightness: 100,
    area: 'pc area',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { mode: 'game', input: 'input2', input_name: 'Gaming' });
  assert.equal(box.execution.mode, 'game');
  assert.equal(box.execution.game.intensity, 'intense');
  assert.equal(box.execution.brightness, 200);
  assert.equal(box.execution.hueTarget, 'f7bd7dcb-bbcb-4cd1-b343-126e60575884');
  await timers.advance(1000);

  ack = await gladys.fake.sceneAction('switch_input', { box: device.external_id, input: 'input4' });
  assert.deepEqual(ack.data.outputs, { input: 'input4', input_name: 'Shield' });

  ack = await gladys.fake.sceneAction('get_state', { box: device.external_id });
  assert.deepEqual(ack.data.outputs, {
    online: true,
    power: true,
    syncing: true,
    mode: 'game',
    input: 'input4',
    input_name: 'Shield',
    brightness: 100,
    intensity: 'intense',
    area: 'PC Area',
  });

  ack = await gladys.fake.sceneAction('stop_sync', { box: device.external_id, then: 'powersave' });
  assert.deepEqual(ack.data.outputs, { mode: 'powersave' });
  assert.equal(box.execution.mode, 'powersave');
  ack = await gladys.fake.sceneAction('start_sync', { box: device.external_id });
  assert.equal(ack.data.outputs.mode, 'game', 'the last sync mode');
  assert.deepEqual(gladys.fake.sceneEvents, []);

  ack = await gladys.fake.sceneAction('start_sync', { box: device.external_id, area: 'Kitchen' });
  assert.match(ack.error, /Unknown entertainment area "Kitchen"; areas: PC Area, TV Area/);
  ack = await gladys.fake.sceneAction('switch_input', { box: 'ext:hs:other', input: 'input1' });
  assert.match(ack.error, /Unknown Sync Box/);
  box.tokens.clear();
  ack = await gladys.fake.sceneAction('get_state', { box: device.external_id });
  assert.equal(ack.data.outputs.online, false);
  await gladys.disconnect();
});

test('Test the boxes, and the status of a created box without registration', async () => {
  const { gladys, device } = await setup();
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(
    ack.data.message.en,
    /^My Sync Box \(192\.168\.1\.12\): Hue Play HDMI Sync Box, firmware 1\.7\.4 \(API 7\), mode powersave, input HDMI 1\.$/,
  );
  // The user saves the form: the registrations (outside the schema) are kept.
  await gladys.fake.configUpdated({ hosts: '', poll_interval: 10 });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  // A box created in Gladys whose registration is gone.
  await gladys.fake.configUpdated({ hosts: 'bad_host', poll_interval: 10, registrations: '{}' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No Sync Box registered/);
  assert.match(gladys.fake.connectionStatus.message.en, /Ignored address\(es\).*position 1/);
  const none = await gladys.fake.action('test_connection', {});
  assert.match(none.data.message.en, /No Sync Box registered/);
  const ack2 = await gladys.fake.setValue(device, { external_id: f('sync') }, 1);
  assert.match(ack2.error, /not registered/);
  await gladys.disconnect();
});

test('a Screen Sync: no power switch, no HDMI input', async () => {
  const state = fixture('state-hsb1-level7.json');
  state.device.deviceType = 'HSC001';
  delete state.hdmi;
  const box = new FakeBox({ state });
  const { gladys, device } = await setup({
    boxes: { [HOST]: box },
    registrations: registration({ device_type: 'HSC001' }),
  });
  assert.equal(gladys.fake.lastState(f('power')), undefined);
  assert.equal(gladys.fake.lastState(f('hdmi_input')), undefined);
  assert.equal(gladys.fake.lastState(f('sync')), 0);
  const ack = await gladys.fake.sceneAction('switch_input', {
    box: device.external_id,
    input: 'input2',
  });
  assert.match(ack.error, /has no HDMI input/);
  await gladys.disconnect();
});
