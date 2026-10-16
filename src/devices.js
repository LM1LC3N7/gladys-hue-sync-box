// -----------------------------------------------------------------------------
// The Gladys device of a Sync Box, and its states. Pure.
//
// External id (forever):  box:<unique id>  (12 hex characters, the id on the
// label of the box, in its certificate and in its mDNS record).
//
// Features (keys forever, see FEATURE):
//   power               switch / binary   on (passthrough or syncing) / power save
//   sync                switch / binary   light sync on / off
//   mode                text / select     powersave, passthrough, video, music, game
//   intensity_video     text / select     subtle, moderate, high, intense
//   intensity_music     text / select
//   intensity_game      text / select
//   brightness          switch / dimmer   0-100 % (50 % = as the source, the API's 100)
//   hdmi_input          text / select     input1-4, labelled with the names of the inputs
//   entertainment_area  text / select     the Hue entertainment areas, by id
// A Screen Sync (HSC…) has no HDMI input and no power switch: those two are
// left out, from its device type, so the structure of a device never changes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { INPUTS, INTENSITIES, MODES, SYNC_MODES } from './constants.js';
import { isHdmiBox, modelName } from './syncbox/model.js';

export const FEATURE = {
  POWER: 'power',
  SYNC: 'sync',
  MODE: 'mode',
  INTENSITY_VIDEO: 'intensity_video',
  INTENSITY_MUSIC: 'intensity_music',
  INTENSITY_GAME: 'intensity_game',
  BRIGHTNESS: 'brightness',
  HDMI_INPUT: 'hdmi_input',
  AREA: 'entertainment_area',
};

/** The intensity feature of each sync mode. */
export const INTENSITY_FEATURES = {
  video: FEATURE.INTENSITY_VIDEO,
  music: FEATURE.INTENSITY_MUSIC,
  game: FEATURE.INTENSITY_GAME,
};

export const MODE_LABELS = {
  powersave: 'Power save',
  passthrough: 'Passthrough (no sync)',
  video: 'Video',
  music: 'Music',
  game: 'Game',
};

export const INTENSITY_LABELS = {
  subtle: 'Subtle',
  moderate: 'Moderate',
  high: 'High',
  intense: 'Intense',
};

export const ids = {
  box: (gladys, uniqueId) => gladys.externalId(`box:${uniqueId}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** The unique id of a box device external id, or undefined. */
export function uniqueIdOf(externalId) {
  return /:box:([0-9A-F]{12})$/.exec(String(externalId ?? ''))?.[1];
}

/** The feature key of a feature external id ("…:box:C42996000000:mode" -> "mode"). */
export const featureKey = (featureExternalId) => String(featureExternalId).split(':').at(-1);

const feature = (id, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(id, key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  ...extra,
});

const select = (id, key, name, options) =>
  feature(id, key, name, C.TEXT, T.TEXT.SELECT, { max: 0, supported_options: options });

/** The HDMI inputs, labelled "Gaming (HDMI 2)", or "HDMI 2" when unnamed or unknown. */
export function inputOptions(inputs = []) {
  const byId = new Map(inputs.map((i) => [i.id, i]));
  return INPUTS.filter((id) => byId.size === 0 || byId.has(id)).map((id) => {
    const generic = `HDMI ${id.slice(-1)}`;
    const name = byId.get(id)?.name ?? '';
    return { value: id, label: name && name !== generic ? `${name} (${generic})` : generic };
  });
}

/** The entertainment areas, by id, labelled with their names. */
export const areaOptions = (areas = []) =>
  areas.map((a) => ({
    value: a.id,
    label: a.lights ? `${a.name} (${a.lights} lights)` : a.name,
  }));

/**
 * A box device. `box`: { uniqueId, name, host, port, deviceType, firmware,
 * inputs, areas } (the registration completed by the last reading). The
 * address lives in the params: a new one (DHCP) is upserted by the next
 * publication of the discovered devices.
 */
export function buildBoxDevice(gladys, box) {
  const id = ids.box(gladys, box.uniqueId);
  const hdmi = isHdmiBox(box.deviceType);
  const features = [
    ...(hdmi
      ? [
          feature(id, FEATURE.POWER, 'Power', C.SWITCH, T.SWITCH.BINARY, {
            keep_history: true,
          }),
        ]
      : []),
    feature(id, FEATURE.SYNC, 'Light sync', C.SWITCH, T.SWITCH.BINARY, { keep_history: true }),
    select(
      id,
      FEATURE.MODE,
      'Mode',
      MODES.filter((m) => hdmi || m !== 'powersave').map((m) => ({
        value: m,
        label: MODE_LABELS[m],
      })),
    ),
    ...SYNC_MODES.map((m) =>
      select(
        id,
        INTENSITY_FEATURES[m],
        `${MODE_LABELS[m]} intensity`,
        INTENSITIES.map((i) => ({ value: i, label: INTENSITY_LABELS[i] })),
      ),
    ),
    feature(id, FEATURE.BRIGHTNESS, 'Brightness', C.SWITCH, T.SWITCH.DIMMER, {
      max: 100,
      unit: U.PERCENT,
    }),
    ...(hdmi ? [select(id, FEATURE.HDMI_INPUT, 'HDMI input', inputOptions(box.inputs))] : []),
    select(id, FEATURE.AREA, 'Entertainment area', areaOptions(box.areas)),
  ];
  const name = box.name || `Hue Sync Box ${box.uniqueId.slice(-4)}`;
  return {
    name,
    external_id: id,
    features,
    params: [
      { name: 'host', value: box.host },
      { name: 'unique_id', value: box.uniqueId },
      { name: 'model', value: modelName(box.deviceType) },
      ...(box.firmware ? [{ name: 'firmware', value: box.firmware }] : []),
    ],
  };
}

const number = (deviceId, key, value) =>
  value === undefined || value === null
    ? []
    : [{ device_feature_external_id: ids.feature(deviceId, key), state: value }];
const choice = (deviceId, key, value) =>
  value ? [{ device_feature_external_id: ids.feature(deviceId, key), text: value }] : [];

/** The states of a reading (src/syncbox/model.js readingOf). */
export function boxStates(deviceId, reading, { hdmi = true } = {}) {
  const area = reading.areas.some((a) => a.id === reading.area) ? reading.area : undefined;
  return [
    ...(hdmi
      ? number(
          deviceId,
          FEATURE.POWER,
          reading.mode ? (reading.mode === 'powersave' ? 0 : 1) : null,
        )
      : []),
    ...number(deviceId, FEATURE.SYNC, reading.syncActive ? 1 : 0),
    ...choice(deviceId, FEATURE.MODE, reading.mode),
    ...SYNC_MODES.flatMap((m) => choice(deviceId, INTENSITY_FEATURES[m], reading.intensity[m])),
    ...number(deviceId, FEATURE.BRIGHTNESS, reading.percent),
    ...(hdmi ? choice(deviceId, FEATURE.HDMI_INPUT, reading.input) : []),
    ...choice(deviceId, FEATURE.AREA, area),
  ];
}
