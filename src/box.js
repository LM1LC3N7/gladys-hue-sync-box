// -----------------------------------------------------------------------------
// BoxLink: one registered box followed live. The API has no push: the whole
// state (GET /api/v1, a few KB) is read every `pollMs` (5 s by default; Home
// Assistant reads every 3 s, homebridge every 5 s), and right after a command.
// Requests to one box run one at a time (SyncBoxClient.serialize).
//
// Offline after TIMINGS.failuresOffline failed reads in a row; a refused
// token keeps being tried, slowly, until a new registration replaces it.
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';
import { SyncBoxClient } from './syncbox/client.js';
import { readingOf } from './syncbox/model.js';

const NOOP = () => {};

export class BoxLink {
  /**
   * @param {object} options
   * @param {object} options.registration { uniqueId, host, port, path, token, … }
   * @param {object} options.transport src/syncbox/https.js transport
   * @param {number} options.pollMs
   * @param {object} [options.timers] { setTimeout, clearTimeout }
   * @param {Function} [options.onReading] (link, reading, previous) => void
   * @param {Function} [options.onFailure] (link, err, { wentOffline }) => void
   */
  constructor({ registration, transport, pollMs, timers, onReading = NOOP, onFailure = NOOP }) {
    this.transport = transport;
    this.timers = timers ?? { setTimeout, clearTimeout };
    this.onReading = onReading;
    this.onFailure = onFailure;
    this.failures = 0;
    this.online = undefined; // unknown until the first read
    this.refused = false;
    this.reading = undefined;
    this.timer = undefined;
    this.running = false;
    this.reads = Promise.resolve();
    this.configure({ registration, pollMs });
  }

  get uniqueId() {
    return this.registration.uniqueId;
  }

  /** A new address, token or interval: the next read uses them. */
  configure({ registration, pollMs }) {
    const r = registration;
    const same =
      this.registration &&
      this.registration.host === r.host &&
      this.registration.port === r.port &&
      this.registration.path === r.path &&
      this.registration.token === r.token;
    this.registration = r;
    this.pollMs = pollMs;
    if (!same) {
      this.client = new SyncBoxClient({
        host: r.host,
        port: r.port,
        path: r.path,
        uniqueId: r.uniqueId,
        token: r.token,
        transport: this.transport,
      });
      this.refused = false;
    }
    return !same;
  }

  start() {
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  schedule(delay) {
    if (!this.running) {
      return;
    }
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      return this.tick();
    }, delay);
  }

  /** Read again soon (after a command), instead of at the next interval. */
  readSoon(delay = TIMINGS.readBack) {
    this.schedule(delay);
  }

  async tick() {
    try {
      await this.read();
    } catch {
      // reported through onFailure
    }
    this.schedule(this.refused ? TIMINGS.pollRefused : this.pollMs);
  }

  /** One read now (reads never overlap). Resolves the reading, or throws. */
  read() {
    const run = this.reads.then(() => this.readOnce());
    this.reads = run.catch(() => {});
    return run;
  }

  async readOnce() {
    let reading;
    try {
      reading = readingOf(await this.client.getState());
    } catch (err) {
      this.failures += 1;
      this.refused = err?.kind === 'auth';
      const wentOffline = this.online !== false && this.failures >= TIMINGS.failuresOffline;
      if (wentOffline || this.refused) {
        this.online = false;
      }
      this.onFailure(this, err, { wentOffline });
      throw err;
    }
    const previous = this.reading;
    const cameBack = this.online !== true;
    this.failures = 0;
    this.refused = false;
    this.online = true;
    this.reading = reading;
    this.onReading(this, reading, { previous, cameBack });
    return reading;
  }
}
