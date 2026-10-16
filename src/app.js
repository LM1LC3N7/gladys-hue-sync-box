// -----------------------------------------------------------------------------
// SyncBoxApp: the integration. Registrations (the button of the box), the
// discovery of the boxes (mDNS through the core, typed addresses), one live
// BoxLink per created box, the commands, the scene actions and triggers, and
// the connection status shown in Gladys.
//
// Every dependency is injected (the SDK client, the HTTPS transport, the
// timers): the tests run this exact code against fake boxes.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { BoxLink } from './box.js';
import { normalizeConfig, parseHost, serializeRegistrations } from './config.js';
import {
  DEFAULT_PATH,
  DEFAULT_PORT,
  INPUTS,
  INTENSITIES,
  LIMITS,
  MODES,
  STOP_TARGETS,
  STORED,
  SYNC_MODES,
  TIMINGS,
} from './constants.js';
import {
  FEATURE,
  INTENSITY_FEATURES,
  boxStates,
  buildBoxDevice,
  featureKey,
  ids,
  uniqueIdOf,
} from './devices.js';
import { boxesOfScan } from './discovery.js';
import { T } from './i18n.js';
import { SyncBoxClient } from './syncbox/client.js';
import { reasonOf } from './syncbox/errors.js';
import { createHttpsTransport } from './syncbox/https.js';
import {
  brightnessOfPercent,
  findArea,
  findInput,
  inputName,
  isHdmiBox,
  readingOf,
  syncModeOf,
  targetOfGroupId,
} from './syncbox/model.js';
import { sceneEvents } from './triggers.js';

/** What the options of a device depend on: a change re-publishes the discovered devices. */
const optionsKey = (reading) =>
  JSON.stringify([
    reading.name,
    reading.firmware,
    reading.inputs.map((i) => i.name),
    reading.areas.map((a) => [a.id, a.name, a.lights]),
  ]);

export class SyncBoxApp {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK client (GladysIntegration or its fake)
   * @param {object} [options.logger]
   * @param {object} [options.transport] src/syncbox/https.js transport
   * @param {object} [options.timers] { setTimeout, clearTimeout } of the poll loops
   * @param {Function} [options.now] the clock
   * @param {Function} [options.sleep] (ms) => Promise, the pace of the registration
   */
  constructor({ gladys, logger, transport, timers, now = Date.now, sleep }) {
    this.gladys = gladys;
    this.logger = logger ?? createLogger({ name: 'hue-sync-box' });
    this.transport = transport ?? createHttpsTransport();
    this.timers = timers ?? { setTimeout, clearTimeout };
    this.now = now;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.raw = {};
    this.config = normalizeConfig({});
    this.links = new Map(); // uniqueId -> BoxLink (created boxes only)
    this.readings = new Map(); // uniqueId -> last reading
    this.optionKeys = new Map(); // uniqueId -> optionsKey of the published device
    this.quietUntil = new Map(); // uniqueId -> ms: no scene event before
    this.lastStatus = undefined;
    this.running = false;
    this.publishing = Promise.resolve();
    this.registering = undefined;
    this.lastRediscovery = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** (Re)start with a configuration; idempotent (also after setConfig echoes). */
  async start(rawConfig) {
    const raw = { ...(rawConfig ?? {}) };
    // The registrations are stored by the integration itself: a configuration
    // without the key (the user saved the form) never drops them.
    if (raw[STORED.REGISTRATIONS] === undefined && this.raw[STORED.REGISTRATIONS] !== undefined) {
      raw[STORED.REGISTRATIONS] = this.raw[STORED.REGISTRATIONS];
    }
    this.raw = raw;
    this.config = normalizeConfig(raw);
    this.running = true;
    if (this.config.invalidHosts.length > 0) {
      this.logger.warn(`Ignored addresses at position ${this.config.invalidHosts.join(', ')}`);
    }
    await this.refreshAll();
    await this.publishDevices();
    this.syncLinks();
    this.updateStatus();
  }

  stop() {
    this.running = false;
    for (const link of this.links.values()) {
      link.stop();
    }
    this.links.clear();
  }

  /** Shutdown: the links, then the kept-alive connections. */
  close() {
    this.stop();
    this.transport.close?.();
  }

  // --- Boxes -----------------------------------------------------------------

  /** The boxes created in Gladys: uniqueId -> device. */
  createdBoxes() {
    const created = new Map();
    for (const device of this.gladys.devices ?? []) {
      const uniqueId = uniqueIdOf(device.external_id);
      if (uniqueId && device.external_id === ids.box(this.gladys, uniqueId)) {
        created.set(uniqueId, device);
      }
    }
    return created;
  }

  /** What the device of a box is built from: its registration and its last reading. */
  boxInfo(uniqueId) {
    const r = this.config.registrations.get(uniqueId);
    const reading = this.readings.get(uniqueId);
    return {
      uniqueId,
      host: r?.host ?? reading?.ipAddress ?? '',
      port: r?.port ?? DEFAULT_PORT,
      name: reading?.name || r?.name || '',
      deviceType: reading?.deviceType || r?.deviceType || '',
      firmware: reading?.firmware ?? '',
      inputs: reading?.inputs ?? [],
      areas: reading?.areas ?? [],
    };
  }

  labelOf(uniqueId) {
    const info = this.boxInfo(uniqueId);
    return info.name ? `${info.name} (${info.host})` : `${uniqueId} (${info.host})`;
  }

  nameOf(uniqueId) {
    return this.boxInfo(uniqueId).name || `Sync Box ${uniqueId}`;
  }

  clientOf(registration) {
    return new SyncBoxClient({
      host: registration.host,
      port: registration.port,
      path: registration.path,
      uniqueId: registration.uniqueId,
      token: registration.token,
      transport: this.transport,
    });
  }

  /** Reads every registered box once (names, inputs, areas for the devices). */
  async refreshAll() {
    await Promise.all(
      [...this.config.registrations.values()].map(async (r) => {
        const link = this.links.get(r.uniqueId);
        try {
          const reading = link ? await link.read() : readingOf(await this.clientOf(r).getState());
          this.readings.set(r.uniqueId, reading);
        } catch (err) {
          this.logger.warn(`${this.labelOf(r.uniqueId)}: reading failed (${reasonOf(err)})`);
        }
      }),
    );
  }

  /** Publishes the registered boxes (calls are chained, the last list wins). */
  publishDevices() {
    this.publishing = this.publishing.then(async () => {
      const devices = [...this.config.registrations.keys()].map((uniqueId) => {
        const reading = this.readings.get(uniqueId);
        if (reading) {
          this.optionKeys.set(uniqueId, optionsKey(reading));
        }
        return buildBoxDevice(this.gladys, this.boxInfo(uniqueId));
      });
      await this.gladys
        .publishDiscoveredDevices(devices)
        .catch((err) =>
          this.logger.warn(`Publishing the discovered devices failed: ${err.message}`),
        );
    });
    return this.publishing;
  }

  /** One live link per created and registered box. */
  syncLinks() {
    if (!this.running) {
      return;
    }
    const created = this.createdBoxes();
    for (const [uniqueId, link] of this.links) {
      if (!created.has(uniqueId) || !this.config.registrations.has(uniqueId)) {
        link.stop();
        this.links.delete(uniqueId);
      }
    }
    for (const uniqueId of created.keys()) {
      const registration = this.config.registrations.get(uniqueId);
      if (!registration) {
        continue;
      }
      const existing = this.links.get(uniqueId);
      if (existing) {
        if (existing.configure({ registration, pollMs: this.config.pollMs })) {
          existing.readSoon(0);
        }
        continue;
      }
      const link = new BoxLink({
        registration,
        transport: this.transport,
        pollMs: this.config.pollMs,
        timers: this.timers,
        onReading: (l, reading, info) => this.onReading(l, reading, info),
        onFailure: (l, err, info) => this.onFailure(l, err, info),
      });
      this.links.set(uniqueId, link);
      link.start();
    }
  }

  deviceCreated() {
    this.syncLinks();
    this.updateStatus();
  }

  deviceDeleted() {
    this.syncLinks();
    this.updateStatus();
  }

  // --- Live state --------------------------------------------------------------

  onReading(link, reading, { previous, cameBack }) {
    const uniqueId = link.uniqueId;
    this.readings.set(uniqueId, reading);
    const deviceId = ids.box(this.gladys, uniqueId);
    if (cameBack) {
      this.gladys
        .publishTransports([{ external_id: deviceId, transport: 'local' }])
        .catch((err) => this.logger.warn(`publishTransports failed: ${err.message}`));
      this.updateStatus();
    }
    if (this.optionKeys.get(uniqueId) !== optionsKey(reading)) {
      // An input or an area renamed: the options of the created device follow.
      this.publishDevices();
    }
    const hdmi = isHdmiBox(this.boxInfo(uniqueId).deviceType);
    this.gladys
      .publishChangedStates(boxStates(deviceId, reading, { hdmi }))
      .catch((err) => this.logger.warn(`Publishing the states failed: ${err.message}`));
    // The first reading (and the first after offline) only arms the triggers.
    if (previous && !cameBack && this.now() >= (this.quietUntil.get(uniqueId) ?? 0)) {
      for (const event of sceneEvents({
        deviceId,
        name: this.nameOf(uniqueId),
        previous,
        reading,
      })) {
        this.gladys
          .publishSceneEvent(event.key, event.data)
          .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
      }
    }
  }

  onFailure(link, err, { wentOffline }) {
    const uniqueId = link.uniqueId;
    this.logger.debug(`${this.labelOf(uniqueId)}: ${reasonOf(err)}`);
    if (wentOffline || err?.kind === 'auth') {
      if (wentOffline) {
        this.logger.warn(`${this.labelOf(uniqueId)} does not answer (${reasonOf(err)})`);
      }
      this.gladys
        .publishTransports([
          { external_id: ids.box(this.gladys, uniqueId), transport: 'unreachable' },
        ])
        .catch((e) => this.logger.warn(`publishTransports failed: ${e.message}`));
      this.updateStatus();
    }
    if (link.online === false && err?.kind === 'unreachable') {
      this.rediscover();
    }
  }

  /** An unreachable box may have a new address (DHCP): mDNS tells, at most every 5 minutes. */
  rediscover() {
    if (this.now() - this.lastRediscovery < TIMINGS.rediscoverEvery) {
      return;
    }
    this.lastRediscovery = this.now();
    this.scanMdns()
      .then((boxes) => this.followAddresses(boxes))
      .catch((err) => this.logger.debug(`Rediscovery failed: ${err.message}`));
  }

  /** Registered boxes found at another address: the registration follows. */
  async followAddresses(found) {
    let changed = false;
    for (const box of found) {
      const r = this.config.registrations.get(box.uniqueId);
      if (r && (r.host !== box.host || r.port !== box.port)) {
        this.logger.info(`${this.labelOf(box.uniqueId)} moved to ${box.host}`);
        this.config.registrations.set(box.uniqueId, { ...r, host: box.host, port: box.port });
        changed = true;
      }
    }
    if (changed) {
      await this.storeRegistrations();
      this.syncLinks();
      await this.publishDevices();
    }
    return changed;
  }

  async storeRegistrations() {
    const value = serializeRegistrations(this.config.registrations);
    this.raw = { ...this.raw, [STORED.REGISTRATIONS]: value };
    await this.gladys
      .setConfig({ [STORED.REGISTRATIONS]: value })
      .catch((err) => this.logger.error(`Saving the registrations failed: ${err.message}`));
  }

  // --- Status ------------------------------------------------------------------

  updateStatus() {
    const registered = this.config.registrations;
    const created = this.createdBoxes();
    let connected;
    const parts = [];
    if (registered.size === 0) {
      connected = false;
      parts.push(T.notRegistered);
    } else {
      const missing = [...created.keys()].filter((id) => !registered.has(id));
      const linked = [...this.links.values()];
      const refused = linked.filter((l) => l.refused);
      // A link that has not read yet (online undefined) is neither.
      const offline = linked.filter((l) => l.online === false && !l.refused);
      const answering = linked.filter((l) => l.online === true);
      if (answering.length > 0) {
        parts.push(T.ok(answering.length));
      }
      if (refused.length > 0) {
        parts.push(T.refused(refused.map((l) => this.nameOf(l.uniqueId))));
      }
      if (offline.length > 0) {
        parts.push(T.unreachable(offline.map((l) => this.nameOf(l.uniqueId))));
      }
      if (missing.length > 0) {
        parts.push(T.missing(missing.map((id) => created.get(id)?.name || id)));
      }
      const notCreated = [...registered.keys()].filter((id) => !created.has(id));
      if (notCreated.length > 0) {
        parts.push(T.notCreated(notCreated.length));
      }
      connected =
        refused.length === 0 &&
        missing.length === 0 &&
        !(linked.length > 0 && offline.length === linked.length);
    }
    if (this.config.invalidHosts.length > 0) {
      parts.push(T.invalidHosts(this.config.invalidHosts));
    }
    const message = parts.length > 0 ? T.join(parts) : undefined;
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Discovery ---------------------------------------------------------------

  /** The boxes answering mDNS (none when the core cannot scan). */
  async scanMdns() {
    try {
      return boxesOfScan(
        await this.gladys.scanNetwork('mdns', { timeoutSeconds: TIMINGS.mdnsSeconds }),
      );
    } catch (err) {
      this.logger.warn(`mDNS scan failed: ${err.message}`);
      return [];
    }
  }

  /**
   * The boxes found: mDNS answers plus the typed addresses (a first contact
   * reads the id from the certificate). A typed address wins over mDNS.
   * @returns {Promise<object[]>} `{ uniqueId, host, port, path, name, deviceType }`
   */
  async findBoxes(extraHosts = []) {
    const found = new Map((await this.scanMdns()).map((b) => [b.uniqueId, b]));
    const typed = [...this.config.hosts, ...extraHosts];
    await Promise.all(
      typed.map(async ({ host, port }) => {
        const client = new SyncBoxClient({ host, port, transport: this.transport });
        try {
          const { uniqueId, device } = await client.probe();
          found.set(uniqueId, {
            uniqueId,
            host,
            port,
            path: DEFAULT_PATH,
            name: typeof device?.name === 'string' ? device.name.slice(0, 60) : '',
            deviceType: typeof device?.deviceType === 'string' ? device.deviceType : '',
          });
        } catch (err) {
          this.logger.warn(`${host}: no Sync Box answers (${reasonOf(err)})`);
        }
      }),
    );
    return [...found.values()].slice(0, LIMITS.boxes);
  }

  /** Discovery "scan": the boxes are searched, the registered ones read and published. */
  async scan() {
    const found = await this.findBoxes();
    await this.followAddresses(found);
    const unregistered = found.filter((b) => !this.config.registrations.has(b.uniqueId));
    for (const box of unregistered) {
      this.logger.info(
        `Found ${box.name || box.uniqueId} at ${box.host}, not registered: use "Register a Sync Box"`,
      );
    }
    await this.refreshAll();
    await this.publishDevices();
    this.syncLinks();
    this.updateStatus();
  }

  // --- Registration ------------------------------------------------------------

  /** Button "Register a Sync Box" (one registration at a time). */
  register(fields = {}) {
    if (!this.registering) {
      this.registering = this.registerBoxes(fields).finally(() => {
        this.registering = undefined;
      });
    }
    return this.registering;
  }

  async registerBoxes(fields) {
    const extra = [];
    if (String(fields.address ?? '').trim()) {
      const parsed = parseHost(fields.address);
      if (!parsed) {
        return T.register.badAddress;
      }
      extra.push(parsed);
    }
    let candidates = await this.findBoxes(extra);
    if (extra.length > 0) {
      candidates = candidates.filter((b) => b.host === extra[0].host);
    }
    if (candidates.length === 0) {
      return T.register.none;
    }
    const labelOf = (b) => (b.name ? `${b.name} (${b.host})` : `${b.uniqueId} (${b.host})`);

    // Boxes already registered with a token they accept are left alone.
    const already = [];
    const pending = [];
    await Promise.all(
      candidates.map(async (box) => {
        const r = this.config.registrations.get(box.uniqueId);
        if (r) {
          try {
            await this.clientOf({ ...r, host: box.host, port: box.port }).getState();
            already.push(labelOf({ ...box, name: box.name || r.name }));
            return;
          } catch (err) {
            if (err.kind !== 'auth') {
              already.push(labelOf({ ...box, name: box.name || r.name }));
              return;
            }
          }
        }
        pending.push({
          box,
          client: new SyncBoxClient({
            host: box.host,
            port: box.port,
            path: box.path,
            uniqueId: box.uniqueId,
            transport: this.transport,
          }),
        });
      }),
    );

    // Until the button is pressed the box answers "Invalid State" (code 16):
    // one attempt per box per second, for TIMINGS.registerWindow.
    const done = [];
    const failed = [];
    const deadline = this.now() + TIMINGS.registerWindow;
    let waiting = pending;
    while (waiting.length > 0 && this.now() < deadline) {
      const next = [];
      for (const entry of waiting) {
        try {
          const credentials = await entry.client.register();
          await this.saveRegistration(entry.box, credentials);
          done.push(labelOf({ ...entry.box, name: this.nameOf(entry.box.uniqueId) }));
        } catch (err) {
          if (err.kind === 'state' || err.kind === 'unreachable') {
            next.push(entry);
          } else {
            failed.push(T.register.failed(labelOf(entry.box), reasonOf(err)));
          }
        }
      }
      waiting = next;
      if (waiting.length > 0) {
        await this.sleep(TIMINGS.registerPace);
      }
    }

    if (done.length > 0) {
      await this.publishDevices();
      this.syncLinks();
      this.updateStatus();
    }
    const parts = [];
    if (done.length > 0) parts.push(T.register.done(done));
    if (already.length > 0) parts.push(T.register.already(already));
    if (waiting.length > 0) parts.push(T.register.noPress(waiting.map((e) => labelOf(e.box))));
    parts.push(...failed);
    return T.join(parts);
  }

  async saveRegistration(box, { registrationId, accessToken }) {
    const registration = {
      uniqueId: box.uniqueId,
      host: box.host,
      port: box.port ?? DEFAULT_PORT,
      path: box.path ?? DEFAULT_PATH,
      token: accessToken,
      registrationId,
      name: box.name ?? '',
      deviceType: box.deviceType ?? '',
    };
    try {
      const reading = readingOf(await this.clientOf(registration).getState());
      this.readings.set(box.uniqueId, reading);
      registration.name = reading.name || registration.name;
      registration.deviceType = reading.deviceType || registration.deviceType;
    } catch (err) {
      this.logger.warn(`${box.host}: registered, but the first reading failed (${reasonOf(err)})`);
    }
    this.config.registrations.set(box.uniqueId, registration);
    await this.storeRegistrations();
    this.logger.info(`Registered ${registration.name || box.uniqueId} at ${box.host}`);
  }

  // --- Button "Test the connection" ----------------------------------------------

  async testConnection() {
    const registrations = [...this.config.registrations.values()];
    if (registrations.length === 0) {
      return T.test.none;
    }
    const lines = await Promise.all(
      registrations.map(async (r) => {
        const label = this.labelOf(r.uniqueId);
        try {
          const link = this.links.get(r.uniqueId);
          const reading = link ? await link.read() : readingOf(await this.clientOf(r).getState());
          this.readings.set(r.uniqueId, reading);
          return T.test.ok(this.labelOf(r.uniqueId), {
            ...reading,
            inputLabel: reading.input ? inputName(reading, reading.input) : '',
          });
        } catch (err) {
          return err.kind === 'auth' ? T.test.refused(label) : T.test.failed(label, reasonOf(err));
        }
      }),
    );
    this.updateStatus();
    return T.join(lines);
  }

  // --- Commands ----------------------------------------------------------------

  /** The registration of a box device (by device external id), or throws. */
  registrationOf(externalId) {
    const uniqueId = uniqueIdOf(externalId);
    if (!uniqueId || externalId !== ids.box(this.gladys, uniqueId)) {
      throw new Error(T.errors.unknownBox);
    }
    const registration = this.config.registrations.get(uniqueId);
    if (!registration) {
      throw new Error(T.errors.notRegistered(this.nameOf(uniqueId)));
    }
    return registration;
  }

  /** The live link of a box, or a one-off one (a box not created in Gladys). */
  linkFor(registration) {
    return (
      this.links.get(registration.uniqueId) ??
      new BoxLink({
        registration,
        transport: this.transport,
        pollMs: this.config.pollMs,
        timers: this.timers,
      })
    );
  }

  /** The last reading of a box, read now when there is none. */
  async readingFor(link) {
    if (link.reading) {
      return link.reading;
    }
    const reading = this.readings.get(link.uniqueId);
    return reading ?? link.read();
  }

  /** The user-facing error of a failed command. */
  commandError(uniqueId, err) {
    const name = this.nameOf(uniqueId);
    if (err.kind === 'auth') return new Error(T.errors.refusedToken(name));
    if (err.kind === 'state') return new Error(T.errors.busy(name));
    if (err.kind === 'refused') return new Error(T.errors.refused(name, reasonOf(err)));
    return new Error(T.errors.unreachable(name, reasonOf(err)));
  }

  /**
   * PUT /execution. An area streamed by another application makes the box
   * answer "Invalid State": as Home Assistant does, that stream is stopped
   * and the command sent again once.
   */
  async execute(link, changes) {
    const uniqueId = link.uniqueId;
    this.quietUntil.set(uniqueId, this.now() + TIMINGS.quietAfterCommand);
    try {
      try {
        await link.client.setExecution(changes);
      } catch (err) {
        if (err.kind !== 'state') {
          throw err;
        }
        const reading = link.reading ?? this.readings.get(uniqueId);
        const busy = reading?.areas.find((a) => a.active);
        if (!busy) {
          throw err;
        }
        this.logger.info(
          `${this.nameOf(uniqueId)}: stopping the stream of "${busy.owner || 'another application'}" on area "${busy.name}"`,
        );
        await link.client.setGroupActive(busy.id, false);
        await link.client.setExecution(changes);
      }
    } catch (err) {
      throw this.commandError(uniqueId, err);
    }
    this.quietUntil.set(uniqueId, this.now() + TIMINGS.quietAfterCommand);
    if (this.links.get(uniqueId) === link) {
      link.readSoon();
    }
  }

  /** A command from Gladys on a feature of a box. */
  async setValue(device, feature, value) {
    const registration = this.registrationOf(device.external_id);
    const link = this.linkFor(registration);
    const key = featureKey(feature.external_id);
    const bad = () => new Error(T.errors.badValue(key, value));
    const text = String(value ?? '').trim();
    switch (key) {
      case FEATURE.POWER: {
        if (Number(value) === 1) {
          const reading = await this.readingFor(link).catch(() => undefined);
          if (reading?.mode && reading.mode !== 'powersave') {
            return; // already on: leave the sync as it is
          }
          return this.execute(link, { mode: 'passthrough' });
        }
        return this.execute(link, { mode: 'powersave' });
      }
      case FEATURE.SYNC:
        return this.execute(link, { syncActive: Number(value) === 1 });
      case FEATURE.MODE:
        if (!MODES.includes(text)) throw bad();
        return this.execute(link, { mode: text });
      case FEATURE.INTENSITY_VIDEO:
      case FEATURE.INTENSITY_MUSIC:
      case FEATURE.INTENSITY_GAME: {
        if (!INTENSITIES.includes(text)) throw bad();
        const mode = SYNC_MODES.find((m) => INTENSITY_FEATURES[m] === key);
        return this.execute(link, { [mode]: { intensity: text } });
      }
      case FEATURE.BRIGHTNESS: {
        const percent = Number(value);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw bad();
        return this.execute(link, { brightness: brightnessOfPercent(percent) });
      }
      case FEATURE.HDMI_INPUT:
        if (!INPUTS.includes(text)) throw bad();
        return this.execute(link, { hdmiSource: text });
      case FEATURE.AREA: {
        const reading = await this.readingFor(link);
        const area = findArea(reading, text);
        if (!area) {
          throw new Error(
            T.errors.unknownArea(
              text,
              reading.areas.map((a) => a.name),
            ),
          );
        }
        return this.execute(link, { hueTarget: targetOfGroupId(area.id) });
      }
      default:
        throw new Error(T.errors.badValue('feature', key));
    }
  }

  // --- Scene actions -------------------------------------------------------------

  /** Start the light sync, with the options given (empty: unchanged). */
  async startSync(fields) {
    const registration = this.registrationOf(fields.box);
    const link = this.linkFor(registration);
    const reading = await this.readingFor(link).catch((err) => {
      throw this.commandError(registration.uniqueId, err);
    });
    const mode = syncModeOf(reading, fields.mode);
    const changes = { mode };
    if (INTENSITIES.includes(fields.intensity)) {
      changes[mode] = { intensity: fields.intensity };
    }
    let input = reading.input;
    if (String(fields.input ?? '').trim()) {
      input = this.inputOf(registration.uniqueId, reading, fields.input);
      changes.hdmiSource = input;
    }
    const brightness = Number(fields.brightness);
    if (fields.brightness !== undefined && fields.brightness !== null && fields.brightness !== '') {
      if (!Number.isFinite(brightness) || brightness < 0 || brightness > 100) {
        throw new Error(T.errors.badValue('brightness', fields.brightness));
      }
      changes.brightness = brightnessOfPercent(brightness);
    }
    if (String(fields.area ?? '').trim()) {
      const area = findArea(reading, fields.area);
      if (!area) {
        throw new Error(
          T.errors.unknownArea(
            fields.area,
            reading.areas.map((a) => a.name),
          ),
        );
      }
      changes.hueTarget = targetOfGroupId(area.id);
    }
    await this.execute(link, changes);
    return { mode, input: input ?? '', input_name: inputName(reading, input) };
  }

  /** Stop the light sync: passthrough (the TV image stays) or power save. */
  async stopSync(fields) {
    const registration = this.registrationOf(fields.box);
    const link = this.linkFor(registration);
    const then = STOP_TARGETS.includes(fields.then) ? fields.then : 'passthrough';
    await this.execute(link, { mode: then });
    return { mode: then };
  }

  inputOf(uniqueId, reading, query) {
    if (!isHdmiBox(this.boxInfo(uniqueId).deviceType)) {
      throw new Error(T.errors.noHdmi(this.nameOf(uniqueId)));
    }
    const input = findInput(reading, query);
    if (!input) {
      throw new Error(T.errors.unknownInput(query));
    }
    return input;
  }

  /** Switch the HDMI input (1-4, or the name of an input). */
  async switchInput(fields) {
    const registration = this.registrationOf(fields.box);
    const link = this.linkFor(registration);
    const reading = await this.readingFor(link).catch((err) => {
      throw this.commandError(registration.uniqueId, err);
    });
    const input = this.inputOf(registration.uniqueId, reading, fields.input);
    await this.execute(link, { hdmiSource: input });
    return { input, input_name: inputName(reading, input) };
  }

  /** The state of a box, read now, for a condition or a message. */
  async getState(fields) {
    const registration = this.registrationOf(fields.box);
    const link = this.linkFor(registration);
    let reading;
    try {
      reading = await link.read();
    } catch {
      return {
        online: false,
        power: false,
        syncing: false,
        mode: '',
        input: '',
        input_name: '',
        brightness: 0,
        intensity: '',
        area: '',
      };
    }
    const syncMode = syncModeOf(reading);
    return {
      online: true,
      power: reading.mode !== 'powersave',
      syncing: Boolean(reading.syncActive),
      mode: reading.mode ?? '',
      input: reading.input ?? '',
      input_name: inputName(reading, reading.input),
      brightness: reading.percent ?? 0,
      intensity: reading.intensity[syncMode] ?? '',
      area: reading.areas.find((a) => a.id === reading.area)?.name ?? '',
    };
  }
}
