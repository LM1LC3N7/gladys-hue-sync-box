import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brightnessOfPercent,
  findArea,
  findInput,
  groupIdOfTarget,
  inputName,
  isHdmiBox,
  modelName,
  percentOfBrightness,
  readingOf,
  syncModeOf,
  targetOfGroupId,
} from '../src/syncbox/model.js';
import { fixture } from './helpers/fakeBox.js';

test('the documented answer (API level 7) reads completely', () => {
  const r = readingOf(fixture('state-hsb1-level7.json'));
  assert.equal(r.uniqueId, 'C42996000000');
  assert.equal(r.name, 'My Sync Box');
  assert.equal(r.deviceType, 'HSB1');
  assert.equal(r.model, 'Hue Play HDMI Sync Box');
  assert.equal(r.firmware, '1.7.4');
  assert.equal(r.apiLevel, 7);
  assert.equal(r.ipAddress, '192.168.1.12');
  assert.equal(r.mode, 'powersave');
  assert.equal(r.syncActive, false);
  assert.equal(r.hdmiActive, false);
  assert.equal(r.lastSyncMode, 'video');
  assert.equal(r.input, 'input1');
  assert.equal(r.brightness, 122);
  assert.equal(r.percent, 61);
  assert.deepEqual(r.intensity, { video: 'moderate', music: 'high', game: 'high' });
  assert.deepEqual(
    r.inputs.map((i) => [i.id, i.name, i.status]),
    [
      ['input1', 'HDMI 1', 'plugged'],
      ['input2', 'Gaming', 'plugged'],
      ['input3', 'HDMI 3', 'unplugged'],
      ['input4', 'Shield', 'plugged'],
    ],
  );
  // Areas sorted by name, ids kept (UUIDs of the bridge API v2).
  assert.deepEqual(
    r.areas.map((a) => [a.id, a.name, a.lights, a.active]),
    [
      ['f7bd7dcb-bbcb-4cd1-b343-126e60575884', 'PC Area', 4, false],
      ['db7dd240-d061-48bf-84c2-01f086e4bfae', 'TV Area', 5, false],
    ],
  );
  assert.equal(r.area, 'db7dd240-d061-48bf-84c2-01f086e4bfae');
  assert.equal(r.bridge, 'connected');
});

test('a syncing 8K box with a bridge API v1 area', () => {
  const r = readingOf(fixture('state-hsb2-syncing.json'));
  assert.equal(r.model, 'Hue Play HDMI Sync Box 8K');
  assert.equal(r.mode, 'game');
  assert.equal(r.syncActive, true);
  assert.equal(r.area, '7'); // "groups/7"
  assert.equal(r.percent, 80);
  assert.equal(inputName(r, r.input), 'PlayStation');
  assert.deepEqual(
    r.areas.map((a) => [a.id, a.active, a.owner]),
    [
      ['8', false, ''],
      ['7', true, 'Hue Sync Box'],
    ],
  );
});

test('unknown values of a future firmware stay out, a non-state is refused', () => {
  const state = fixture('state-hsb1-level7.json');
  state.execution.mode = 'ambient';
  state.execution.video.intensity = 'extreme';
  state.execution.hdmiSource = 'input9';
  delete state.execution.syncActive;
  delete state.hdmi;
  const r = readingOf(state);
  assert.equal(r.mode, undefined);
  assert.equal(r.intensity.video, undefined);
  assert.equal(r.input, undefined);
  assert.equal(r.syncActive, false);
  assert.deepEqual(r.inputs, []);
  assert.throws(() => readingOf({ device: {} }), { kind: 'protocol' });
  assert.throws(() => readingOf('<html>'), { kind: 'protocol' });
});

test('brightness: 0-200 on the box, 0-100 % in Gladys, 50 % = as the source', () => {
  assert.equal(percentOfBrightness(100), 50);
  assert.equal(percentOfBrightness(200), 100);
  assert.equal(percentOfBrightness(0), 0);
  assert.equal(percentOfBrightness(undefined), undefined);
  assert.equal(brightnessOfPercent(50), 100);
  assert.equal(brightnessOfPercent(100), 200);
  assert.equal(brightnessOfPercent(33.3), 67);
  assert.equal(brightnessOfPercent(150), 200);
});

test('entertainment area targets: bridge API v1 numbers, v2 UUIDs', () => {
  assert.equal(groupIdOfTarget('groups/7'), '7');
  assert.equal(
    groupIdOfTarget('db7dd240-d061-48bf-84c2-01f086e4bfae'),
    'db7dd240-d061-48bf-84c2-01f086e4bfae',
  );
  assert.equal(targetOfGroupId('7'), 'groups/7');
  assert.equal(targetOfGroupId('db7dd240-d061'), 'db7dd240-d061');
  const r = readingOf(fixture('state-hsb2-syncing.json'));
  assert.equal(findArea(r, 'bedroom')?.id, '8');
  assert.equal(findArea(r, '7')?.name, 'Living room');
  assert.equal(findArea(r, 'groups/8')?.name, 'Bedroom');
  assert.equal(findArea(r, 'Kitchen'), undefined);
  assert.equal(findArea(r, ''), undefined);
});

test('inputs by id, number or name', () => {
  const r = readingOf(fixture('state-hsb1-level7.json'));
  assert.equal(findInput(r, 'input3'), 'input3');
  assert.equal(findInput(r, '2'), 'input2');
  assert.equal(findInput(r, 'HDMI 4'), 'input4');
  assert.equal(findInput(r, 'gaming'), 'input2');
  assert.equal(findInput(r, 'Shield'), 'input4');
  assert.equal(findInput(r, '5'), undefined);
  assert.equal(findInput(r, 'Wii'), undefined);
  assert.equal(inputName(r, 'input3'), 'HDMI 3');
  assert.equal(inputName({ inputs: [] }, 'input2'), 'HDMI 2');
});

test('the sync mode a start goes to', () => {
  assert.equal(syncModeOf({ mode: 'powersave', lastSyncMode: 'music' }), 'music');
  assert.equal(syncModeOf({ mode: 'game', lastSyncMode: 'video' }), 'game');
  assert.equal(syncModeOf({ mode: 'passthrough', lastSyncMode: 'game' }, 'video'), 'video');
  assert.equal(syncModeOf({ mode: 'passthrough' }), 'video');
});

test('models', () => {
  assert.equal(modelName('HSB3'), 'Hue Play HDMI Sync Box 4K');
  assert.equal(modelName('HSC001'), 'Hue Play Screen Sync');
  assert.equal(modelName('HSB9'), 'Hue Sync (HSB9)');
  assert.equal(modelName(''), 'Hue Sync Box');
  assert.equal(isHdmiBox('HSB1'), true);
  assert.equal(isHdmiBox(''), true);
  assert.equal(isHdmiBox('HSC001'), false);
});
