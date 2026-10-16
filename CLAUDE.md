# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its
only runtime dependency (HTTPS goes through `node:https`). It drives the
Philips Hue Play HDMI Sync Box through its official local API (HTTPS, JSON,
`/api/v1`): one device per box, its state polled (the API has no push),
registration with the button of the box, two scene triggers, four scene
actions. Local only. Unofficial: not affiliated with Signify (Philips Hue).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
bash e2e/run.sh                           # the image against a fake box (Docker)
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js                 SDK bootstrap only
src/handlers.js          every SDK handler -> the app (shared with the tests)
src/app.js               SyncBoxApp: registrations, discovery, one link per created
                         box, states and scene events, commands, scene actions,
                         buttons, connection status
src/box.js               BoxLink: the poll loop of one box, offline / refused
src/syncbox/client.js    one box: every request, one at a time
src/syncbox/https.js     the only network access (node:https, Sync Box root CA only,
                         unique id in the certificate, deadline, size cap, keep-alive)
src/syncbox/certificate.js  the Sync Box root CA published by Philips Hue
src/syncbox/model.js     answers -> readings, area targets, brightness (pure)
src/syncbox/errors.js    SyncBoxError and its kinds
src/discovery.js         mDNS answers -> boxes (pure)
src/devices.js           the box device, feature keys, external id, states (pure)
src/triggers.js          readings -> the two scene events (pure)
src/config.js            config_schema normalized, the stored registrations
src/constants.js         API values, timings, limits, manifest keys
src/i18n.js              runtime texts (en/fr)
test/fixtures/           the documented answer (aiohuesyncbox, Apache-2.0), a
                         constructed one, the mDNS records, test certificates
test/helpers/            a fake box (in memory, transport, loopback HTTPS), fake
                         timers; Gladys is the SDK's fake
e2e/                     the image against a fake box container (Docker)
```

## The protocol, as built

- `https://<box>:443/api/v1…`, JSON, `Authorization: Bearer <accessToken>`.
  Errors: non-200 with `{ code, message }`; 1-3 = token refused, 16 =
  "Invalid State", 13 = "Invalid Key".
- TLS: the chain must lead to the Sync Box root CA (`root-hsb`); the leaf's
  common name is the unique id of the box (12 hex). SNI = that id, as
  aiohuesyncbox sends it.
- Registration: `POST /registrations { appName, instanceName }`, no token;
  16 until the button is held, then `{ registrationId, accessToken }`.
- State: `GET /api/v1` (device, execution, hdmi, hue…).
- Commands: `PUT /execution` with `mode`, `syncActive`, `hdmiSource`,
  `brightness` (0-200), `hueTarget` (`groups/<n>` or a UUID),
  `{ video|music|game: { intensity } }`. Power on = `mode: passthrough`
  from powersave only; power off = `mode: powersave` (Home Assistant's
  switch). 16 on a command: free the active area
  (`PUT /hue/groups/<id> { active: false }`) and retry once.
- mDNS: `_huesync._tcp`, TXT `uniqueid`, `path`, `name`, `devicetype`.

## Rules

- **Unofficial**: every user-facing surface says "unofficial connector, not
  affiliated with Signify (Philips Hue)". Never use a Philips or Hue logo.
- **Keys are forever**: the manifest keys (`src/constants.js`), the feature
  keys (`FEATURE` in `src/devices.js`), the option values (API values:
  `video`, `input2`, area ids), the stored key `registrations` and the
  external id shape `box:<unique id>` are stored in user scenes, dashboards
  and configurations. Never rename them.
- **Trust**: never disable the certificate check, never add a CA to the
  process; the root CA stays the only one in production (`ca` is injected by
  the tests and the e2e only). Never log a token or a header.
- **Be gentle with the box**: one request at a time per box, a full read
  every `poll_interval` seconds (5 by default) plus one after a command.
- **One event per transition** (`src/triggers.js`): the first reading (and
  the first after offline) only arms; a change caused by a command sent
  through Gladys arms silently (`quietUntil`, 15 s).
- **Local only**: the client talks to the addresses of the boxes (mDNS
  answers, typed addresses, registrations).
- **Built blind**: no box was at hand. Every request lives in `src/syncbox/`,
  so a tester's report fixes one place; `TODO.md` lists what to confirm.
- **Read-only rootfs**: write nothing on disk (the registrations go through
  `setConfig`).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag.
- **Changelog**: every user-visible change adds a line under
  `## [Unreleased]` in `CHANGELOG.md`.
- **Manifest texts** are `{ en, fr }` objects; the catalog description holds
  10 to 100 characters per language; `test/manifest.test.js` ties the
  manifest to the code.
- **User-facing text** is bilingual, `docs/en.md` and `docs/fr.md` kept in
  sync. Comments explain why, in English.
- **Tests never touch the network** (the transport is injected; the loopback
  HTTPS servers of `test/http.test.js` are the only sockets).

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is
  not a bug in the code.

## Refreshing the fixtures

With a box on the LAN and a token (anonymize the unique id, IP addresses,
Wi-Fi name and bridge id first):

```bash
B=https://192.168.1.30/api/v1
curl -sk -H "Authorization: Bearer $TOKEN" "$B"
```
