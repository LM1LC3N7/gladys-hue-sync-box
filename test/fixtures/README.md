# Test fixtures

No Sync Box was at hand when this integration was written: the fixtures are
the documented answers of the HDMI Sync Box API, and answers shaped after
them.

| File                      | Origin                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state-hsb1-level7.json`  | The example answer of `GET /api/v1` in the Philips Hue "HDMI Sync Box API" documentation (API level 7), as recorded in [aiohuesyncbox](https://github.com/mvdwetering/aiohuesyncbox) `tests/test_compatibility.py` (Apache-2.0, © Michel van de Wetering). Unchanged.                                                                                          |
| `state-hsb2-syncing.json` | Built for these tests on the same shape: a Sync Box 8K (HSB2, API level 14) syncing in game mode on its second input, a bridge API v1 area (`groups/7`, active), and the fields aiohuesyncbox's models document for levels 10 and 14 (`temperature`, `overheating`, `undervolt`, `bluetooth`, `hue.groupId`, `hue.operatingMode`). Not recorded on a real box. |
| `tls/`                    | Test certificates made by `tls/make.sh`: a test CA standing for the Sync Box root CA, two boxes it issued (common name = unique id) and a self-signed impostor. Test-only keys; the integration trusts the Philips Hue root CA only.                                                                                                                           |

The error bodies (`{ "code": 16, "message": "Invalid State" }` until the
button is pressed, codes 1-3 for a refused token) follow aiohuesyncbox's
`errors.py` and the registration steps described by
[homebridge-philips-hue-sync-box](https://github.com/jabrown93/homebridge-philips-hue-sync-box)
(MIT). The mDNS records (`_huesync._tcp`, TXT `uniqueid`, `path`, `name`,
`devicetype`) follow the zeroconf tests of
[Home Assistant's huesyncbox](https://github.com/mvdwetering/huesyncbox)
(Apache-2.0).
