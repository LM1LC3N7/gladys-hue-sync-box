# TODO — Philips Hue Sync Box v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the claim is in /t/10385 (post #224); the release goes in a recap message
  there, with a link to the repo.

## Status

- [x] **Milestone 1 — core** (2026-10-16): registration through the button
      of the box ("Register a Sync Box": every box found and not registered
      is asked once a second for 90 s; the token is stored with `setConfig`
      outside the schema); discovery over mDNS (`_huesync._tcp`) through the
      core plus typed addresses (the unique id read from the certificate at
      the first contact); one device per box (`box:<unique id>`) with power,
      light sync, mode, intensity of video / music / game, brightness (%),
      HDMI input (named like in the Hue Sync app) and entertainment area;
      state read every 5 s (2-60) and after each command, changed values
      only; unreachable after three failed reads, badge, mDNS rediscovery of
      a new address every 5 min at most; a refused token reported and read
      once a minute; an area streamed by another application freed then the
      command retried (as Home Assistant); scene triggers `mode_changed`,
      `input_changed` (silent 15 s after a Gladys command); scene actions
      `start_sync`, `stop_sync`, `switch_input`, `get_state`; buttons
      "Register a Sync Box", "Test the boxes". HTTPS trusting the Sync Box
      root CA only, checking the unique id of the box. Tested against fake
      boxes (in memory, loopback HTTPS with test certificates, a Docker
      container for the image read-only under 256 MB / 0.5 CPU) and the SDK
      fake Gladys. No real box.
- [ ] **Milestone 2 — a real box**: a tester's box (see "To check on a real
      box"), a `GET /api/v1` capture turned into a fixture (anonymized).
- [ ] **Milestone 3 — more**:
  - read-only features: content (`hdmi.contentSpecs`, e.g. "3840 x 2160 @
    60000 - HDR10"), HDMI input status (linked / plugged / unplugged), bridge
    connection state, temperature / overheating (API level 10+);
  - background lighting (video, game) and music palette selects;
  - the presets of the box (`/presets`, API level 9+) as a scene action;
  - "forget the box": `DELETE /registrations/<id>` when the device is
    deleted, from a button;
  - a Gladys-side scene trigger "content changed" (HDR / SDR, resolution);
  - the Hue Play Screen Sync (HSC…): same API, no HDMI and no power; the
    device already leaves those out, untested.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public (the main session publishes, with Louis's OK).

## To check on a real box

- mDNS through the core: does `_huesync._tcp` answer with an IPv4 address,
  port 443 and the TXT `uniqueid`, `path`, `name`?
- TLS: is the leaf certificate accepted by Node 24 with the root CA only
  (Python's strict mode accepts it for Home Assistant), with the unique id as
  common name? Does the box need the SNI?
- `GET /api/v1/device` without a token: answered or 401 (the first contact
  with a typed address relies on the certificate either way)?
- Registration: is one `POST` per second for 90 s accepted (Home Assistant
  does the same, without a limit)? Does it need the sync stopped (the
  Homebridge README says so)?
- Power: `mode: passthrough` from power save wakes the box and the TV (CEC)?
  `mode: powersave` while syncing?
- `{ "game": { "intensity": "high" } }` while another mode syncs: kept for
  later (Homebridge writes it this way)?
- `syncActive: true` from power save: does it start in `lastSyncMode`?
- `hueTarget` on a bridge API v2 (UUID) and v1 (`groups/<n>`): which form
  does a current box report, and does `hue.groupId` (API level 10+) matter?
- Freeing a busy area: does `PUT /hue/groups/<id> { active: false }` stop
  the Hue Sync desktop app, and does the retry then succeed?
- The keep-alive connection: does the box close it between two reads 5 s
  apart (the transport retries once on a reset), and how long does a read
  take?

## Decisions

- **Not a duplicate** (checked 2026-10-16): the Gladys core master
  (0027571e, 2026-10-16) has a `philips-hue` service for the Hue bridge only
  (`git grep -i 'huesync\|sync box\|hdmi sync\|/api/v1/execution'` over
  `server/` and `front/src` is empty); cicoub13/gladys-philips-hue 2.0.2
  drives the bridge lights (SSDP + `_hue._tcp`), not the Sync Box. The main
  session checked the store index (433 entries), GitHub and the forum the
  same day: no Hue Sync Box integration, none claimed. Claimed in /t/10385
  #224 (tracker n° 255).
- **Own client, no library** (Louis's reuse rule): npm has no Sync Box
  library, only plugins: `homebridge-philips-hue-sync-box` 3.1.2 (MIT, active,
  a Homebridge plugin built on homebridge-lib, node-fetch and async-lock),
  `iobroker.hue-sync-box` 0.3.5 (February 2023, inactive),
  `homebridge-philips-hue-sync-box-switches` (2022). The maintained library is
  Python: aiohuesyncbox 0.1.6 (Apache-2.0, Home Assistant's huesyncbox,
  updated September 2026). The API is small (four requests), so: a ~300-line
  client on `node:https` (`src/syncbox/client.js`, `https.js`), those projects read as
  documentation (credited in the README), the documented example answer they
  record used unchanged as a fixture. The only runtime dependency stays the
  SDK.
- **TLS**: the Sync Box root CA published by Philips Hue, only, per request
  (`ca`), never the process trust store nor `rejectUnauthorized: false`;
  the leaf common name must be the unique id (from mDNS or the
  registration), as aiohuesyncbox does (`server_hostname=id`,
  `hostname_checks_common_name`). Homebridge skips the name check; we keep
  it, and pin the id at the first contact with a typed address (trust on
  first use anchored to the Sync Box CA).
- **Token storage**: `setConfig({ registrations: <JSON string> })`, a key
  outside the `config_schema` (the SDK's documented "free internal storage,
  never shown in the UI"). A configuration saved without the key keeps the
  registrations in memory and in the next store.
- **Polling, not long polling**: the API has no push nor etag; a full read
  every 5 s by default (Home Assistant 3 s, Homebridge 5 s), configurable
  2-60 s, one request at a time per box, `publishChangedStates` so only the
  changes count against the 300 states per minute.
- **Features**: power and sync as `switch` / `binary` (dashboard toggles),
  brightness as `switch` / `dimmer` 0-100 % (not `light`, so the box is not
  counted as a light in the rooms), mode, intensities, input and area as
  `text` / `select` with the API values as option values (stable, the labels
  follow the Hue Sync app). Brightness 50 % = API 100 = as the source (Home
  Assistant maps 1-100 % to 0-200 the same way, Homebridge 0-100 to 0-200).
- **Power on** goes to passthrough from power save only (Home Assistant's
  switch): turning on a syncing box changes nothing.
- **Busy area**: like Home Assistant, a command refused with code 16 while
  an area is active frees it (`PUT /hue/groups/<id> { active: false }`)
  and is sent once more; nothing to free -> a clear error.
- **Triggers** mode / input only (the values that change outside Gladys);
  their filters are the API values.
- `gladys_version >=5.1.0`: scene declarations and dynamic selects.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable (unused), bridge network. Measured in the e2e: image 174 MB, RSS
  80 MB.
- Tests never touch the network: the transport is injected
  (`test/http.test.js` uses loopback HTTPS servers with test certificates).
