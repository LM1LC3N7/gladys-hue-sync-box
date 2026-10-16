// -----------------------------------------------------------------------------
// Answers of the Sync Box API -> what the integration reads, and what it
// writes back. Pure.
//
// GET /api/v1 (shape of the example of the Philips Hue documentation, API
// level 7, as recorded in aiohuesyncbox's tests; newer levels add fields):
//   device     { name, deviceType, uniqueId, apiLevel, firmwareVersion, ipAddress… }
//   execution  { mode, syncActive, hdmiActive, hdmiSource, hueTarget, brightness,
//                lastSyncMode, video{intensity}, game{intensity}, music{intensity} }
//   hdmi       { input1..input4 { name, type, status }, contentSpecs… } (Sync Boxes)
//   hue        { groups { <id>: { name, numLights, active, owner? } }, connectionState… }
// -----------------------------------------------------------------------------

import { INPUTS, INTENSITIES, MODES, SYNC_MODES } from '../constants.js';
import { UNIQUE_ID } from './https.js';
import { SyncBoxError } from './errors.js';

/** Model names of `device.deviceType` (Home Assistant's huesyncbox list). */
export const MODEL_NAMES = {
  HSB1: 'Hue Play HDMI Sync Box',
  HSB2: 'Hue Play HDMI Sync Box 8K',
  HSB3: 'Hue Play HDMI Sync Box 4K',
  HSC001: 'Hue Play Screen Sync',
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 100) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const oneOf = (value, list) => (list.includes(value) ? value : undefined);

/** A Sync Box (HSB…) has HDMI inputs and a power switch; a Screen Sync (HSC…) has none. */
export const isHdmiBox = (deviceType) => !/^HSC/i.test(String(deviceType ?? ''));

/** The friendly model name of a device type. */
export const modelName = (deviceType) =>
  MODEL_NAMES[deviceType] ?? (deviceType ? `Hue Sync (${text(deviceType, 20)})` : 'Hue Sync Box');

/** "groups/3" (bridge API v1) or a UUID (bridge API v2) -> the id of `hue.groups`. */
export const groupIdOfTarget = (target) => text(target, 80).replace(/^groups\//, '');

/** The `hueTarget` of an area id: "groups/<n>" for a numeric id (as Home Assistant does). */
export const targetOfGroupId = (id) => (/^\d+$/.test(String(id)) ? `groups/${id}` : String(id));

/** Brightness of the API (0-200, 100 = as the source) <-> percent in Gladys (50 % = as the source). */
export const percentOfBrightness = (value) =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value / 2))) : undefined;
export const brightnessOfPercent = (percent) => Math.max(0, Math.min(200, Math.round(percent * 2)));

function inputsOf(hdmi) {
  if (!isObject(hdmi)) {
    return [];
  }
  return INPUTS.filter((id) => isObject(hdmi[id])).map((id, index) => ({
    id,
    number: Number(id.slice(-1)) || index + 1,
    name: text(hdmi[id].name, 60),
    type: text(hdmi[id].type, 30),
    status: text(hdmi[id].status, 20),
  }));
}

function areasOf(hue) {
  if (!isObject(hue?.groups)) {
    return [];
  }
  return Object.entries(hue.groups)
    .filter(([id, group]) => isObject(group) && text(id, 80))
    .map(([id, group]) => ({
      id: text(id, 80),
      name: text(group.name, 60) || id,
      lights: Number.isInteger(group.numLights) ? group.numLights : undefined,
      active: group.active === true,
      owner: text(group.owner, 80),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The whole state -> a reading:
 *   { uniqueId, name, deviceType, model, firmware, apiLevel, ipAddress,
 *     mode, syncActive, hdmiActive, lastSyncMode, input, brightness (0-200),
 *     percent, intensity { video, music, game }, inputs [...], areas [...],
 *     area (id), bridge (connection state) }
 * Unknown enum values (a future firmware) are kept out (undefined).
 */
export function readingOf(state) {
  const device = state?.device;
  const execution = state?.execution;
  if (!isObject(device) || !isObject(execution)) {
    throw new SyncBoxError('protocol', 'the answer is not a Sync Box state');
  }
  const uniqueId = text(device.uniqueId, 20).toUpperCase();
  const deviceType = text(device.deviceType, 20);
  const mode = oneOf(execution.mode, MODES);
  const intensity = {};
  for (const syncMode of SYNC_MODES) {
    intensity[syncMode] = oneOf(execution[syncMode]?.intensity, INTENSITIES);
  }
  const brightness = Number.isFinite(execution.brightness) ? execution.brightness : undefined;
  return {
    uniqueId: UNIQUE_ID.test(uniqueId) ? uniqueId : undefined,
    name: text(device.name, 60),
    deviceType,
    model: modelName(deviceType),
    firmware: text(device.firmwareVersion, 30),
    apiLevel: Number.isInteger(device.apiLevel) ? device.apiLevel : undefined,
    ipAddress: text(device.ipAddress, 45),
    mode,
    syncActive:
      typeof execution.syncActive === 'boolean' ? execution.syncActive : SYNC_MODES.includes(mode),
    hdmiActive: typeof execution.hdmiActive === 'boolean' ? execution.hdmiActive : undefined,
    lastSyncMode: oneOf(execution.lastSyncMode, SYNC_MODES),
    input: oneOf(execution.hdmiSource, INPUTS),
    brightness,
    percent: percentOfBrightness(brightness),
    intensity,
    inputs: inputsOf(state.hdmi),
    areas: areasOf(state.hue),
    area: groupIdOfTarget(execution.hueTarget) || undefined,
    bridge: text(state.hue?.connectionState, 30),
  };
}

/** The name of an input in a reading ("Gaming", else "HDMI 2"). */
export function inputName(reading, inputId) {
  const input = reading?.inputs?.find((i) => i.id === inputId);
  return input?.name || (inputId ? `HDMI ${inputId.slice(-1)}` : '');
}

/** The sync mode a "start" goes to: the given one, else the current or last one. */
export function syncModeOf(reading, wanted) {
  if (SYNC_MODES.includes(wanted)) {
    return wanted;
  }
  if (SYNC_MODES.includes(reading?.mode)) {
    return reading.mode;
  }
  return reading?.lastSyncMode ?? 'video';
}

/** An area of a reading by id or name (case-insensitive), or undefined. */
export function findArea(reading, query) {
  const wanted = text(String(query ?? ''), 80);
  if (!wanted) {
    return undefined;
  }
  const lower = wanted.toLowerCase();
  const areas = reading?.areas ?? [];
  return (
    areas.find((a) => a.id === wanted) ??
    areas.find((a) => a.name.toLowerCase() === lower) ??
    areas.find((a) => groupIdOfTarget(wanted) === a.id)
  );
}

/** An input by id ("input2"), number ("2", "HDMI 2") or name ("Gaming"), or undefined. */
export function findInput(reading, query) {
  const wanted = text(String(query ?? ''), 60).toLowerCase();
  if (!wanted) {
    return undefined;
  }
  if (INPUTS.includes(wanted)) {
    return wanted;
  }
  const number = /^(?:hdmi\s*|input\s*)?([1-4])$/.exec(wanted)?.[1];
  if (number) {
    return `input${number}`;
  }
  return reading?.inputs?.find((i) => i.name.toLowerCase() === wanted)?.id;
}
