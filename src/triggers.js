// -----------------------------------------------------------------------------
// Two consecutive readings of a box -> the scene events (pure). One event per
// transition: the first reading only arms (src/app.js), and the changes made
// through Gladys are made silent there too (no loop through a scene).
//
//   mode_changed   the mode changed (sync started or stopped, other sync
//                  mode, power save, back on)
//   input_changed  the box switched to another HDMI input
// -----------------------------------------------------------------------------

import { LIMITS, SCENE_TRIGGERS } from './constants.js';
import { inputName } from './syncbox/model.js';

const clip = (value) => String(value ?? '').slice(0, LIMITS.eventText);

/**
 * @param {object} args
 * @param {string} args.deviceId the box device external id
 * @param {string} args.name the box name
 * @param {object} args.previous the previous reading
 * @param {object} args.reading the new reading
 * @returns {{ key: string, data: object }[]}
 */
export function sceneEvents({ deviceId, name, previous, reading }) {
  const events = [];
  const common = {
    box: deviceId,
    box_name: clip(name),
    input: reading.input ?? null,
    input_name: clip(inputName(reading, reading.input)),
  };
  if (reading.mode && previous?.mode && reading.mode !== previous.mode) {
    events.push({
      key: SCENE_TRIGGERS.MODE,
      data: {
        ...common,
        mode: reading.mode,
        previous_mode: previous.mode,
        syncing: Boolean(reading.syncActive),
      },
    });
  }
  if (reading.input && previous?.input && reading.input !== previous.input) {
    events.push({
      key: SCENE_TRIGGERS.INPUT,
      data: {
        ...common,
        previous_input: previous.input,
        previous_input_name: clip(inputName(previous, previous.input)),
        mode: reading.mode ?? null,
      },
    });
  }
  return events;
}
