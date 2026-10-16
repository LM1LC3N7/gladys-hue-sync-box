// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOUNDS, DEFAULTS } from '../src/config.js';
import {
  ACTIONS,
  INPUTS,
  INTENSITIES,
  MDNS_SERVICE,
  MODES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  STOP_TARGETS,
  SYNC_MODES,
} from '../src/constants.js';
import { sceneEvents } from '../src/triggers.js';
import { readingOf } from '../src/syncbox/model.js';
import { fixture } from './helpers/fakeBox.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const byKey = (list, key) => list.find((item) => item.key === key);
const keys = (list) => (list ?? []).map((item) => item.key);
const values = (field) => field.options.map((o) => o.value);

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.1\.0/, 'scene declarations need 5.1');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-hue-sync-box:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-hue-sync-box');
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['lighting', 'multimedia']);
  assert.equal(manifest.location, undefined, 'no house location needed');
  assert.equal(manifest.containers, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.ok(
    manifest.name.length >= 3 && manifest.name.length <= 30,
    'the store allows 30 characters',
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with Signify/);
  assert.match(manifest.config_schema[0].description.fr, /sans lien avec Signify/);
});

test('every text is bilingual, sections within their limits', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang} too long`);
    }
    assert.equal(section.default, undefined);
    assert.ok(section.links.every((l) => l.url.startsWith('https://')));
  }
});

test('discovery asks the core for the mDNS service of the boxes', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  assert.ok(handlers.includes('onScanRequest('));
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.equal(fields.poll_interval.min, BOUNDS.poll_interval.min);
  assert.equal(fields.poll_interval.max, BOUNDS.poll_interval.max);
  assert.deepEqual(keys(manifest.config_schema), ['intro', ...Object.keys(DEFAULTS)]);
  // The registrations are stored outside the schema, never shown.
  assert.equal(fields.registrations, undefined);
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  assert.deepEqual(keys(manifest.scene_actions).sort(), Object.values(SCENE_ACTIONS).sort());
  assert.deepEqual(keys(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(handlers.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
});

test('trigger filters are the values the events carry; every field and variable is in the event', () => {
  const mode = byKey(manifest.scene_triggers, SCENE_TRIGGERS.MODE);
  const input = byKey(manifest.scene_triggers, SCENE_TRIGGERS.INPUT);
  assert.deepEqual(values(byKey(mode.fields, 'mode')), MODES);
  assert.deepEqual(values(byKey(input.fields, 'input')), INPUTS);
  const base = readingOf(fixture('state-hsb1-level7.json'));
  const events = sceneEvents({
    deviceId: 'ext:hs:box:C42996000000',
    name: 'My Sync Box',
    previous: base,
    reading: { ...base, mode: 'video', syncActive: true, input: 'input2' },
  });
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, trigger.key);
    for (const key of keys([...trigger.fields, ...trigger.variables])) {
      assert.ok(key in event.data, `${trigger.key}.${key} is not in the event`);
    }
    assert.ok(Object.keys(event.data).length <= 30);
    assert.equal(byKey(trigger.fields, 'box').source, 'devices');
  }
});

test('the scene actions: options, fields, outputs (returned values checked by test/app.test.js)', () => {
  const action = (key) => byKey(manifest.scene_actions, key);
  const start = action(SCENE_ACTIONS.START_SYNC);
  assert.deepEqual(values(byKey(start.fields, 'mode')), SYNC_MODES);
  assert.deepEqual(values(byKey(start.fields, 'intensity')), INTENSITIES);
  assert.deepEqual(values(byKey(start.fields, 'input')), INPUTS);
  assert.deepEqual(values(byKey(action(SCENE_ACTIONS.STOP_SYNC).fields, 'then')), STOP_TARGETS);
  assert.deepEqual(values(byKey(action(SCENE_ACTIONS.SWITCH_INPUT).fields, 'input')), INPUTS);
  const outputs = (key) => keys(action(key).outputs);
  assert.deepEqual(outputs(SCENE_ACTIONS.START_SYNC), ['mode', 'input', 'input_name']);
  assert.deepEqual(outputs(SCENE_ACTIONS.STOP_SYNC), ['mode']);
  assert.deepEqual(outputs(SCENE_ACTIONS.SWITCH_INPUT), ['input', 'input_name']);
  assert.deepEqual(outputs(SCENE_ACTIONS.GET_STATE), [
    'online',
    'power',
    'syncing',
    'mode',
    'input',
    'input_name',
    'brightness',
    'intensity',
    'area',
  ]);
  for (const a of manifest.scene_actions) {
    const box = byKey(a.fields, 'box');
    assert.equal(box.source, 'devices', `${a.key}.box`);
    assert.equal(box.required, true, `${a.key}.box`);
    assert.ok(a.fields.length <= 10 && a.outputs.length <= 20, a.key);
  }
});
