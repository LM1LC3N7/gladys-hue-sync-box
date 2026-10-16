import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  FEATURE,
  areaOptions,
  boxStates,
  buildBoxDevice,
  featureKey,
  ids,
  inputOptions,
  uniqueIdOf,
} from '../src/devices.js';
import { readingOf } from '../src/syncbox/model.js';
import { fixture } from './helpers/fakeBox.js';

const reading = readingOf(fixture('state-hsb1-level7.json'));
const box = {
  uniqueId: 'C42996000000',
  host: '192.168.1.12',
  port: 443,
  name: reading.name,
  deviceType: reading.deviceType,
  firmware: reading.firmware,
  inputs: reading.inputs,
  areas: reading.areas,
};

test('one device per box, accepted by Gladys', async () => {
  const gladys = createFakeGladys({ selector: 'hue-sync-box' });
  const device = buildBoxDevice(gladys, box);
  assert.equal(device.external_id, 'ext:hue-sync-box:box:C42996000000');
  assert.equal(device.name, 'My Sync Box');
  assert.deepEqual(
    device.features.map((f) => featureKey(f.external_id)),
    [
      'power',
      'sync',
      'mode',
      'intensity_video',
      'intensity_music',
      'intensity_game',
      'brightness',
      'hdmi_input',
      'entertainment_area',
    ],
  );
  assert.deepEqual(device.params, [
    { name: 'host', value: '192.168.1.12' },
    { name: 'unique_id', value: 'C42996000000' },
    { name: 'model', value: 'Hue Play HDMI Sync Box' },
    { name: 'firmware', value: '1.7.4' },
  ]);
  const hdmi = device.features.find((f) => f.external_id.endsWith(':hdmi_input'));
  assert.deepEqual(hdmi.supported_options, [
    { value: 'input1', label: 'HDMI 1' },
    { value: 'input2', label: 'Gaming (HDMI 2)' },
    { value: 'input3', label: 'HDMI 3' },
    { value: 'input4', label: 'Shield (HDMI 4)' },
  ]);
  await gladys.connect();
  // The fake Gladys refuses what Gladys refuses (categories, types, units…).
  await gladys.publishDiscoveredDevices([device]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('a Screen Sync has no power switch nor HDMI input, an unnamed box a default name', () => {
  const gladys = createFakeGladys({ selector: 's' });
  const device = buildBoxDevice(gladys, { ...box, name: '', deviceType: 'HSC001' });
  const keys = device.features.map((f) => featureKey(f.external_id));
  assert.ok(!keys.includes(FEATURE.POWER));
  assert.ok(!keys.includes(FEATURE.HDMI_INPUT));
  assert.ok(
    !device.features
      .find((f) => featureKey(f.external_id) === FEATURE.MODE)
      .supported_options.some((o) => o.value === 'powersave'),
  );
  assert.equal(device.name, 'Hue Sync Box 0000');
});

test('options before the first reading, and the areas', () => {
  assert.deepEqual(
    inputOptions([]).map((o) => o.label),
    ['HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI 4'],
  );
  assert.deepEqual(areaOptions(reading.areas), [
    { value: 'f7bd7dcb-bbcb-4cd1-b343-126e60575884', label: 'PC Area (4 lights)' },
    { value: 'db7dd240-d061-48bf-84c2-01f086e4bfae', label: 'TV Area (5 lights)' },
  ]);
});

test('external ids', () => {
  const gladys = createFakeGladys({ selector: 'hs' });
  const id = ids.box(gladys, 'C42996000000');
  assert.equal(uniqueIdOf(id), 'C42996000000');
  assert.equal(uniqueIdOf(`${id}:mode`), undefined);
  assert.equal(uniqueIdOf('ext:hs:box:nothex'), undefined);
  assert.equal(featureKey(ids.feature(id, 'entertainment_area')), 'entertainment_area');
});

test('the states of a reading, accepted by Gladys', async () => {
  const deviceId = 'ext:hue-sync-box:box:C42996000000';
  const states = boxStates(deviceId, reading);
  const byKey = Object.fromEntries(
    states.map((s) => [featureKey(s.device_feature_external_id), s.text ?? s.state]),
  );
  assert.deepEqual(byKey, {
    power: 0,
    sync: 0,
    mode: 'powersave',
    intensity_video: 'moderate',
    intensity_music: 'high',
    intensity_game: 'high',
    brightness: 61,
    hdmi_input: 'input1',
    entertainment_area: 'db7dd240-d061-48bf-84c2-01f086e4bfae',
  });
  const syncing = boxStates(deviceId, readingOf(fixture('state-hsb2-syncing.json')));
  const s = Object.fromEntries(
    syncing.map((x) => [featureKey(x.device_feature_external_id), x.text ?? x.state]),
  );
  assert.equal(s.power, 1);
  assert.equal(s.sync, 1);
  assert.equal(s.mode, 'game');
  assert.equal(s.entertainment_area, '7');
  const gladys = createFakeGladys({ selector: 'hue-sync-box' });
  await gladys.connect();
  await gladys.publishStates(states);
  // A Screen Sync publishes neither power nor input; an unknown area is left out.
  const screen = boxStates(deviceId, { ...reading, area: 'gone' }, { hdmi: false });
  assert.deepEqual(
    screen.map((x) => featureKey(x.device_feature_external_id)),
    ['sync', 'mode', 'intensity_video', 'intensity_music', 'intensity_game', 'brightness'],
  );
});
