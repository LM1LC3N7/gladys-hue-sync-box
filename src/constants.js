// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their scenes and
// configuration), the values of the Sync Box API, and the tuning of the
// integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  REGISTER: 'register',
  TEST: 'test_connection',
};

/** Manifest `scene_actions` keys. */
export const SCENE_ACTIONS = {
  START_SYNC: 'start_sync',
  STOP_SYNC: 'stop_sync',
  SWITCH_INPUT: 'switch_input',
  GET_STATE: 'get_state',
};

/** Manifest `scene_triggers` keys. */
export const SCENE_TRIGGERS = {
  MODE: 'mode_changed',
  INPUT: 'input_changed',
};

/**
 * Configuration key the integration stores itself (setConfig), outside the
 * config_schema: never shown in the UI. Its value is a JSON string (see
 * src/config.js, `registrations`). Frozen, like the schema keys.
 */
export const STORED = {
  REGISTRATIONS: 'registrations',
};

/** mDNS service type of the Sync Box, mirrored by the manifest `network_discovery`. */
export const MDNS_SERVICE = '_huesync._tcp';

/** HTTPS port and base path of the API (mDNS TXT `path`, "/api" on every box seen). */
export const DEFAULT_PORT = 443;
export const DEFAULT_PATH = '/api';

/** The name the box shows in its list of registered applications (Hue Sync app). */
export const APP_NAME = 'Gladys Assistant';
export const INSTANCE_NAME = 'Gladys';

// --- Values of the API (execution resource) ----------------------------------

/** `execution.mode`, in the order shown in Gladys. */
export const MODES = ['powersave', 'passthrough', 'video', 'music', 'game'];
/** The modes that sync the lights. */
export const SYNC_MODES = ['video', 'music', 'game'];
export const INTENSITIES = ['subtle', 'moderate', 'high', 'intense'];
export const INPUTS = ['input1', 'input2', 'input3', 'input4'];
/** What a stopped sync leaves the box in (scene action `stop_sync`). */
export const STOP_TARGETS = ['passthrough', 'powersave'];

/** Error codes of the API (`{ code, message }` bodies). */
export const API_CODES = {
  /** 1-3: the token is missing, invalid or revoked. */
  AUTH: [1, 2, 3],
  /** 16: "Invalid State": no button press yet, or the area is streamed by another app. */
  INVALID_STATE: 16,
};

// --- Tuning --------------------------------------------------------------------

export const LIMITS = {
  /** Body of an answer: the whole state is a few KB. */
  responseBytes: 256 * 1024,
  /** Boxes followed (a home has one or two). */
  boxes: 20,
  /** Addresses typed in the configuration. */
  hosts: 20,
  /** Scene event strings. */
  eventText: 200,
};

export const TIMINGS = {
  /** One HTTPS request. */
  requestTimeout: 8000,
  /** Poll interval bounds and default (seconds, config `poll_interval`). */
  pollDefault: 5,
  pollMin: 2,
  pollMax: 60,
  /** A box whose token is refused is still read this often (a new registration fixes it). */
  pollRefused: 60_000,
  /** After a command, the state is read again this soon (feedback in Gladys). */
  readBack: 400,
  /** Consecutive failed reads before a box is shown unreachable. */
  failuresOffline: 3,
  /** An unreachable box is searched again with mDNS at most this often (new DHCP address). */
  rediscoverEvery: 5 * 60_000,
  /** The changes that follow a command sent through Gladys fire no scene event. */
  quietAfterCommand: 15_000,
  /** Registration: how long the user has to press the button, and the request pace. */
  registerWindow: 90_000,
  registerPace: 1000,
  /** mDNS scan duration (seconds, 1-30). */
  mdnsSeconds: 5,
};
