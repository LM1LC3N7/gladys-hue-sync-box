// -----------------------------------------------------------------------------
// A fake Hue Sync Box: the API the integration uses, in memory, with the
// behaviour the documentation and the reference projects describe:
//   - GET /api/v1 and PUT /api/v1/execution need `Authorization: Bearer`;
//   - POST /api/v1/registrations answers { code: 16, "Invalid State" } until
//     the button is pressed, then { registrationId, accessToken };
//   - PUT /api/v1/execution: mode / syncActive / hdmiActive move together
//     (powersave: both off, passthrough: hdmi only, video|music|game: both),
//     an unknown key is { code: 13, "Invalid Key" }, starting the sync while
//     another application streams to the area is { code: 16 };
//   - PUT /api/v1/hue/groups/<id> { active: false } frees an area.
// Served three ways: `handle()` directly, `fakeTransport()` (the transport
// the client expects, no socket) and `serveBox()` (node:https, loopback).
// -----------------------------------------------------------------------------

import https from 'node:https';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
export const tlsFile = (name) => readFileSync(new URL(`../fixtures/tls/${name}`, import.meta.url));

const MODES = ['powersave', 'passthrough', 'video', 'music', 'game'];
const SYNC = ['video', 'music', 'game'];
const INTENSITIES = ['subtle', 'moderate', 'high', 'intense'];
const INPUTS = ['input1', 'input2', 'input3', 'input4'];
const EXECUTION_KEYS = new Set([
  'mode',
  'syncActive',
  'hdmiActive',
  'hdmiSource',
  'brightness',
  'hueTarget',
  'intensity',
  'video',
  'music',
  'game',
]);

const json = (status, data) => ({
  status,
  contentType: 'application/json',
  body: data === undefined ? '' : JSON.stringify(data),
});
const error = (status, code, message) => json(status, { code, message });

export class FakeBox {
  constructor({
    state = fixture('state-hsb1-level7.json'),
    tokens = ['token-1'],
    path = '/api',
  } = {}) {
    this.state = structuredClone(state);
    this.uniqueId = this.state.device.uniqueId;
    this.tokens = new Set(tokens);
    this.path = path;
    this.requests = [];
    this.buttonPressed = false;
    this.registrations = 0;
    /** Another application streaming to an area: { groupId, owner }. */
    this.busy = undefined;
  }

  pressButton() {
    this.buttonPressed = true;
  }

  get execution() {
    return this.state.execution;
  }

  /** A change made outside Gladys (the Hue Sync app, the TV remote…). */
  set(changes) {
    const answer = this.applyExecution(changes);
    if (answer) {
      throw new Error(`fake box refused ${JSON.stringify(changes)}: ${answer.body}`);
    }
  }

  handle({ method, path, headers = {}, body }) {
    const resource = path.startsWith(`${this.path}/v1`) ? path.slice(this.path.length + 3) : null;
    const auth = String(headers.authorization ?? headers.Authorization ?? '');
    const authorized = auth.startsWith('Bearer ') && this.tokens.has(auth.slice(7));
    let data;
    if (body) {
      try {
        data = JSON.parse(body);
      } catch {
        return error(400, 10, 'Invalid JSON');
      }
    }
    this.requests.push({ method, resource, authorized, data });
    if (resource === null) {
      return error(404, 14, 'Invalid Path');
    }
    if (method === 'POST' && resource === '/registrations') {
      if (!this.buttonPressed) {
        return error(400, 16, 'Invalid State');
      }
      this.buttonPressed = false;
      this.registrations += 1;
      const token = `token-${this.registrations + 1}`;
      this.tokens.add(token);
      return json(200, { registrationId: String(this.registrations + 1), accessToken: token });
    }
    if (!authorized) {
      return error(401, 1, 'Unauthorized');
    }
    if (method === 'GET' && resource === '') {
      return json(200, this.state);
    }
    if (method === 'GET' && resource === '/device') {
      return json(200, this.state.device);
    }
    if (method === 'PUT' && resource === '/execution') {
      return this.applyExecution(data ?? {}) ?? json(200, undefined);
    }
    const group = /^\/hue\/groups\/([^/]+)$/.exec(resource ?? '');
    if (method === 'PUT' && group) {
      const id = decodeURIComponent(group[1]);
      if (!this.state.hue.groups[id]) {
        return error(400, 12, 'Invalid Value');
      }
      this.state.hue.groups[id].active = Boolean(data?.active);
      if (!data?.active && this.busy?.groupId === id) {
        this.busy = undefined;
      }
      return json(200, undefined);
    }
    return error(404, 14, 'Invalid Path');
  }

  applyExecution(changes) {
    const e = this.state.execution;
    for (const key of Object.keys(changes)) {
      if (!EXECUTION_KEYS.has(key)) {
        return error(400, 13, 'Invalid Key');
      }
    }
    if (Object.keys(changes).length === 0) {
      return error(400, 13, 'Invalid Key');
    }
    let mode = e.mode;
    if (changes.mode !== undefined) {
      if (!MODES.includes(changes.mode)) return error(400, 12, 'Invalid Value');
      mode = changes.mode;
    }
    if (changes.syncActive === true) mode = SYNC.includes(mode) ? mode : e.lastSyncMode;
    if (changes.syncActive === false && SYNC.includes(mode)) mode = 'passthrough';
    if (changes.hdmiActive === true && mode === 'powersave') mode = 'passthrough';
    if (changes.hdmiActive === false) mode = 'powersave';
    if (SYNC.includes(mode) && !SYNC.includes(e.mode) && this.busy) {
      return error(400, 16, 'Invalid State');
    }
    if (changes.hdmiSource !== undefined && !INPUTS.includes(changes.hdmiSource)) {
      return error(400, 12, 'Invalid Value');
    }
    if (
      changes.brightness !== undefined &&
      !(
        Number.isInteger(changes.brightness) &&
        changes.brightness >= 0 &&
        changes.brightness <= 200
      )
    ) {
      return error(400, 12, 'Invalid Value');
    }
    if (changes.hueTarget !== undefined) {
      const id = String(changes.hueTarget).replace(/^groups\//, '');
      if (!this.state.hue.groups[id]) return error(400, 12, 'Invalid Value');
    }
    for (const syncMode of SYNC) {
      if (
        changes[syncMode]?.intensity !== undefined &&
        !INTENSITIES.includes(changes[syncMode].intensity)
      ) {
        return error(400, 12, 'Invalid Value');
      }
    }
    // Valid: apply.
    e.mode = mode;
    e.syncActive = SYNC.includes(mode);
    e.hdmiActive = mode !== 'powersave';
    if (SYNC.includes(mode)) e.lastSyncMode = mode;
    if (changes.hdmiSource !== undefined) e.hdmiSource = changes.hdmiSource;
    if (changes.brightness !== undefined) e.brightness = changes.brightness;
    if (changes.hueTarget !== undefined) e.hueTarget = changes.hueTarget;
    for (const syncMode of SYNC) {
      if (changes[syncMode]) e[syncMode] = { ...e[syncMode], ...changes[syncMode] };
    }
    if (changes.intensity !== undefined && SYNC.includes(mode)) {
      e[mode] = { ...e[mode], intensity: changes.intensity };
    }
    return undefined;
  }
}

/**
 * The transport of src/syncbox/https.js, without sockets: `boxes` maps a
 * host to a FakeBox; a missing or `down` box refuses the connection, an
 * unexpected id is refused like the TLS identity check does.
 */
export function fakeTransport(boxes) {
  const transport = {
    boxes,
    calls: [],
    down: new Set(),
    async request({ host, port, path, method, headers, body, expectedId }) {
      transport.calls.push({ host, port, path, method, expectedId });
      await Promise.resolve();
      const box = boxes instanceof Map ? boxes.get(host) : boxes[host];
      if (!box || transport.down.has(host)) {
        throw Object.assign(new Error(`connect ECONNREFUSED ${host}:${port}`), {
          code: 'ECONNREFUSED',
        });
      }
      if (expectedId && expectedId !== box.uniqueId) {
        throw Object.assign(new Error(`another Sync Box answered (${box.uniqueId})`), {
          code: 'ERR_SYNCBOX_IDENTITY',
        });
      }
      return { ...box.handle({ method, path, headers, body }), peerId: box.uniqueId };
    },
    close() {},
  };
  return transport;
}

/** The box over HTTPS on the loopback, with a test certificate. */
export function serveBox(box, { cert = 'box', host = '127.0.0.1', port = 0 } = {}) {
  const server = https.createServer(
    { cert: tlsFile(`${cert}.pem`), key: tlsFile(`${cert}.key`) },
    (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const answer = box.handle({
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(answer.status, { 'content-type': answer.contentType });
        res.end(answer.body);
      });
    },
  );
  return new Promise((resolve) => {
    server.listen(port, host, () =>
      resolve({
        server,
        port: server.address().port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      }),
    );
  });
}
