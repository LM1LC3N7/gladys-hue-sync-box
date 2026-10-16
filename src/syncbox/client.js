// -----------------------------------------------------------------------------
// One Sync Box: the requests of the HDMI Sync Box API (v1) the integration
// uses, one at a time (the box handles few connections; aiohuesyncbox and
// homebridge-philips-hue-sync-box serialize theirs too).
//
//   GET  /api/v1                      the whole state (device, execution, hdmi, hue…)
//   PUT  /api/v1/execution            mode, syncActive, hdmiSource, brightness,
//                                     hueTarget, <mode>.intensity
//   PUT  /api/v1/hue/groups/<id>      { active: false }: free an area streamed by
//                                     another application (as Home Assistant does)
//   POST /api/v1/registrations        { appName, instanceName }, no token: answers
//                                     code 16 until the button of the box is pressed,
//                                     then { registrationId, accessToken }
//
// Errors are `{ code, message }` JSON bodies with a non-200 status.
// -----------------------------------------------------------------------------

import { API_CODES, APP_NAME, DEFAULT_PATH, DEFAULT_PORT, INSTANCE_NAME } from '../constants.js';
import { SyncBoxError, fromNetworkError } from './errors.js';

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A non-200 answer -> the SyncBoxError it means. */
export function answerError({ status, body }) {
  const data = parseJson(body);
  const code = Number.isInteger(data?.code) ? data.code : undefined;
  const text = typeof data?.message === 'string' ? data.message.slice(0, 120) : '';
  const message = code !== undefined ? `${code}: ${text || 'error'}` : `HTTP ${status}`;
  if (API_CODES.AUTH.includes(code) || status === 401 || status === 403) {
    return new SyncBoxError('auth', message, { status, code });
  }
  if (code === API_CODES.INVALID_STATE) {
    return new SyncBoxError('state', message, { status, code });
  }
  return new SyncBoxError(code !== undefined ? 'refused' : 'protocol', message, { status, code });
}

export class SyncBoxClient {
  /**
   * @param {object} options
   * @param {string} options.host IP address or host name
   * @param {number} [options.port]
   * @param {string} [options.path] API base path (mDNS TXT `path`)
   * @param {string} [options.uniqueId] the id the certificate must carry
   * @param {string} [options.token] the access token of the registration
   * @param {object} options.transport `{ request }` (src/syncbox/https.js)
   */
  constructor({ host, port = DEFAULT_PORT, path = DEFAULT_PATH, uniqueId, token, transport }) {
    this.host = host;
    this.port = port;
    this.base = `${String(path || DEFAULT_PATH).replace(/\/+$/, '')}/v1`;
    this.uniqueId = uniqueId;
    this.token = token;
    this.transport = transport;
    this.queue = Promise.resolve();
  }

  /** Requests run one after the other. */
  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async call(method, resource, { json, auth = true } = {}) {
    const headers = { accept: 'application/json' };
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    if (auth) {
      if (!this.token) {
        throw new SyncBoxError('auth', 'not registered');
      }
      headers.authorization = `Bearer ${this.token}`;
    }
    let answer;
    try {
      answer = await this.transport.request({
        host: this.host,
        port: this.port,
        path: `${this.base}${resource}`,
        method,
        headers,
        body,
        expectedId: this.uniqueId,
      });
    } catch (err) {
      throw fromNetworkError(err);
    }
    // First contact with a typed address: the id of the certificate is kept.
    if (!this.uniqueId && answer.peerId) {
      this.uniqueId = answer.peerId;
    }
    if (answer.status !== 200) {
      throw answerError(answer);
    }
    if (answer.body.trim() === '') {
      return undefined;
    }
    const data = parseJson(answer.body);
    if (data === undefined) {
      throw new SyncBoxError('protocol', 'the answer is not JSON', { status: answer.status });
    }
    return data;
  }

  /** The whole state (GET /api/v1). */
  getState() {
    return this.serialize(() => this.call('GET', ''));
  }

  /** PUT /api/v1/execution with a partial execution object. */
  setExecution(changes) {
    return this.serialize(() => this.call('PUT', '/execution', { json: changes }));
  }

  /** PUT /api/v1/hue/groups/<id>: start or stop the streaming of an entertainment area. */
  setGroupActive(groupId, active) {
    return this.serialize(() =>
      this.call('PUT', `/hue/groups/${encodeURIComponent(groupId)}`, { json: { active } }),
    );
  }

  /**
   * One registration attempt (POST /api/v1/registrations, no token). Throws a
   * `state` SyncBoxError until the button of the box was pressed.
   * @returns {Promise<{ registrationId: string, accessToken: string }>}
   */
  async register({ appName = APP_NAME, instanceName = INSTANCE_NAME } = {}) {
    const data = await this.serialize(() =>
      this.call('POST', '/registrations', { json: { appName, instanceName }, auth: false }),
    );
    const accessToken = typeof data?.accessToken === 'string' ? data.accessToken.trim() : '';
    if (!accessToken) {
      throw new SyncBoxError('protocol', 'the registration answer has no access token');
    }
    return { registrationId: String(data.registrationId ?? ''), accessToken };
  }

  /**
   * A first contact without a token (GET /api/v1/device): the box answers, or
   * refuses without a token, either way its certificate names it.
   * @returns {Promise<{ uniqueId: string, device?: object }>}
   */
  async probe() {
    let device;
    try {
      device = await this.serialize(() => this.call('GET', '/device', { auth: false }));
    } catch (err) {
      if (err.kind !== 'auth' || !this.uniqueId) {
        throw err;
      }
    }
    if (!this.uniqueId) {
      throw new SyncBoxError('identity', 'the certificate does not name a Sync Box');
    }
    return { uniqueId: this.uniqueId, device };
  }
}
