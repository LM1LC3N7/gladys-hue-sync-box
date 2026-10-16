import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneEvents } from '../src/triggers.js';
import { readingOf } from '../src/syncbox/model.js';
import { fixture } from './helpers/fakeBox.js';

const deviceId = 'ext:hs:box:C42996000000';
const base = readingOf(fixture('state-hsb1-level7.json'));
const at = (changes) => ({ ...base, ...changes });

test('the sync starts: mode_changed with the input', () => {
  const events = sceneEvents({
    deviceId,
    name: 'My Sync Box',
    previous: at({ mode: 'passthrough' }),
    reading: at({ mode: 'video', syncActive: true }),
  });
  assert.deepEqual(events, [
    {
      key: 'mode_changed',
      data: {
        box: deviceId,
        box_name: 'My Sync Box',
        input: 'input1',
        input_name: 'HDMI 1',
        mode: 'video',
        previous_mode: 'passthrough',
        syncing: true,
      },
    },
  ]);
});

test('a console turns on: input_changed (and mode_changed when the box follows)', () => {
  const events = sceneEvents({
    deviceId,
    name: 'My Sync Box',
    previous: at({ mode: 'video', input: 'input1' }),
    reading: at({ mode: 'game', input: 'input2', syncActive: true }),
  });
  assert.deepEqual(
    events.map((e) => e.key),
    ['mode_changed', 'input_changed'],
  );
  assert.deepEqual(events[1].data, {
    box: deviceId,
    box_name: 'My Sync Box',
    input: 'input2',
    input_name: 'Gaming',
    previous_input: 'input1',
    previous_input_name: 'HDMI 1',
    mode: 'game',
  });
});

test('nothing changed, or an unknown value: no event', () => {
  assert.deepEqual(sceneEvents({ deviceId, name: 'x', previous: base, reading: base }), []);
  assert.deepEqual(
    sceneEvents({ deviceId, name: 'x', previous: base, reading: at({ mode: undefined }) }),
    [],
  );
  assert.deepEqual(
    sceneEvents({ deviceId, name: 'x', previous: undefined, reading: at({ mode: 'video' }) }),
    [],
  );
});
