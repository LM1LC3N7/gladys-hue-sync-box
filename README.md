# gladys-hue-sync-box

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Philips Hue Play HDMI Sync Box**, on the local network through its
official API: power, light sync, mode, intensity, brightness, HDMI input and
entertainment area, with scene triggers and scene actions. No account, no
cloud. **Unofficial connector, not affiliated with Signify (Philips Hue).**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (SyncBoxApp)
                 ├─ src/box.js                one live link per created box: the poll loop
                 ├─ src/syncbox/client.js     the requests of one box, one at a time
                 ├─ src/syncbox/https.js      the only network access (node:https, pinned CA)
                 ├─ src/syncbox/model.js      answers -> readings, values to write (pure)
                 ├─ src/discovery.js          mDNS answers -> boxes (pure)
                 ├─ src/devices.js            the box device and its states (pure)
                 └─ src/triggers.js           readings -> scene events (pure)
```

- **Registration**: the "Register a Sync Box" button sends
  `POST /api/v1/registrations` once a second to every box found and not yet
  registered; the box answers `16 Invalid State` until its button is held,
  then gives an access token, stored with `setConfig` outside the
  `config_schema` (never shown, never logged).
- **Discovery**: the core browses `_huesync._tcp` over mDNS
  (`network_discovery`, TXT `uniqueid`, `path`, `name`); typed addresses
  are contacted directly. Registered boxes are published in Discovery.
- **Live state**: the API has no push. The whole state (`GET /api/v1`, a few
  KB) is read every 5 s (configurable, 2-60 s) and right after a command;
  only the changed values reach Gladys (`publishChangedStates`). Three
  failed reads make a box unreachable; an unreachable box is looked for again
  by mDNS (new DHCP address) at most every 5 minutes.
- **HTTPS**: the box certificate must be issued by the Sync Box root CA
  published by Philips Hue (`src/syncbox/certificate.js`), and only that CA,
  for these requests only; its common name must be the unique id of the box
  (from mDNS, or pinned at the first contact with a typed address). A
  self-signed certificate, a public CA or another box are refused.
- **Commands**: `PUT /api/v1/execution` (`mode`, `syncActive`,
  `hdmiSource`, `brightness`, `hueTarget`, `<mode>.intensity`). An area
  streamed by another application (`16 Invalid State`) is freed with
  `PUT /api/v1/hue/groups/<id>` and the command sent again, as Home
  Assistant does.
- **Triggers** come from two consecutive readings; the first one only arms,
  and the changes made through Gladys fire nothing for 15 seconds.

## Development

```bash
npm install
npm test                                        # node --test, no network but loopback
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npx github:GladysAssistant/integration-store .  # store admission checks
bash e2e/run.sh                                 # the image against a fake box, in Docker
```

The only runtime dependency is the Gladys SDK: no Node.js Sync Box library
exists, only plugins (see [TODO.md](TODO.md), "Decisions"), so the client is
a small one on `node:https`.

## Credits

- Philips Hue's **HDMI Sync Box API** documentation (developers.meethue.com)
  and the Sync Box root CA it publishes. Not redistributed here, except that
  public CA certificate.
- [aiohuesyncbox](https://github.com/mvdwetering/aiohuesyncbox) (Apache-2.0)
  and the [Home Assistant huesyncbox integration](https://github.com/mvdwetering/huesyncbox)
  (Apache-2.0) by Michel van de Wetering: the models of the API, the TLS
  check (root CA + unique id), the registration loop, the mapping of power,
  brightness and areas, freeing a busy area. Read as documentation, no code
  copied; the documented example answer they record is a test fixture
  (`test/fixtures/`, see its README).
- [homebridge-philips-hue-sync-box](https://github.com/jabrown93/homebridge-philips-hue-sync-box)
  (MIT) by Jared Brown and Lukas Rögner: the per-mode intensity writes, the
  request pacing and the registration steps. Read as documentation.

This first version was built without a box: see [TODO.md](TODO.md) for what
a real one must confirm.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
