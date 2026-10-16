# Philips Hue Sync Box

**Unofficial connector, not affiliated with Signify (Philips Hue).** It
brings the **Philips Hue Play HDMI Sync Box** (the original, 4K and 8K
models) into Gladys, through the official local API of the box, on your
network: no account, no cloud.

**Testers wanted**: this first version was written without a box at hand,
from the Hue Sync Box API documentation, the library of the Home Assistant
integration and the Homebridge plugin. It was tested against a simulated box.
Tell us on the forum what works with yours, and what does not.

## What you get

| Surface                      | Content                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One device per **box**       | power (on / power save), light sync (on / off), mode (power save, passthrough, video, music, game), intensity of each sync mode, brightness, HDMI input, entertainment area |
| Scene triggers               | **mode changed** (the sync started or stopped, another mode, power save), **HDMI input changed**                                                                            |
| Scene actions                | **start the light sync** (mode, intensity, input, brightness, area), **stop the light sync**, **switch the HDMI input**, **read the state**                                 |
| Buttons of the configuration | **Register a Sync Box**, **Test the boxes**                                                                                                                                 |

The box has no way to tell Gladys that something changed: Gladys reads its
state every 5 seconds (the **Refresh interval** of the configuration, 2 to
60 seconds) and right after each command, and only sends Gladys the values
that changed. A change made in the Hue Sync app, with the TV remote or by the
box itself (a console turning on) shows up within that time.

## Getting started

1. Install the integration and open its **Configuration** tab.
2. Click **Register a Sync Box**, then, within a minute, **hold the button on
   the front of the box** for about 3 seconds, until its light blinks green,
   and release it. The answer under the button names the registered box.
   The box shows "Gladys Assistant" in the list of applications of the Hue
   Sync app.
3. Open **Discovery** and add the box.

The box must already be set up in the Hue Sync app (Hue bridge and
entertainment areas). It is found on the network by mDNS (`_huesync._tcp`,
as the Hue Sync app finds it). Not found (multicast blocked, another
network)? Type its IP address in the **Address** field of the button, or in
**Box addresses** of the configuration (the Hue Sync app shows it in
Settings → Device). Give the box a fixed address in your router; if its
address changes anyway, Gladys looks for it again by mDNS.

## The device

- **Power**: off puts the box in power save; on wakes it up in passthrough
  (the image goes through, the lights stay as they are). Turning it on while
  it syncs does nothing.
- **Light sync**: on starts the sync in the last mode used; off goes back to
  passthrough.
- **Mode**: power save, passthrough, video, music or game.
- **Video / Music / Game intensity**: subtle, moderate, high or intense, for
  each mode, also when another mode is active.
- **Brightness**: 0 to 100 %; **50 % is the brightness of the source**, below
  dims the lights, above boosts them (the box's own scale is 0-200).
- **HDMI input**: input 1 to 4, shown with the names given in the Hue Sync
  app ("Gaming (HDMI 2)").
- **Entertainment area**: the Hue entertainment areas of the bridge the box
  is paired with.

The names of the inputs and areas follow the Hue Sync app a few seconds after
you change them.

## Scenes

- **Mode changed**: a box (or none for any), and optionally the new mode.
  Variables: the box name, the new and the previous mode, whether the lights
  sync, the name of the HDMI input. For example: "when the sync starts, close
  the blinds".
- **HDMI input changed**: optionally the new input (1-4). Variables: the box
  name, the new and the previous input (number and name), the mode. For
  example: "when the console input is selected, turn off the ceiling light".
- **Start the light sync**: the mode (empty: the last one), and optionally
  the intensity, the HDMI input, the brightness (%) and the name of an
  entertainment area. A box in power save is turned on. Outputs: the mode,
  the input and its name.
- **Stop the light sync**: then stay on (passthrough) or go to power save.
- **Switch the HDMI input**: input 1 to 4. Outputs: the input and its name.
- **Read the state** gives `online`, `power`, `syncing`, `mode`, `input`,
  `input_name`, `brightness`, `intensity`, `area` for a condition or a
  message. The following actions of the scene find them in their variable
  list.

Changes made through Gladys (a command, a scene) fire none of the
integration's triggers for 15 seconds: a scene can never loop through the
box. The generic **Control a device** action also drives power, sync and
brightness.

## Good to know

- When another application streams to the entertainment area (the Hue Sync
  app on a computer, another box), the box refuses to start syncing; Gladys
  then stops that stream and starts again, as Home Assistant does.
- Gladys sends one request at a time to a box. A box that stops answering is
  shown unreachable after three failed reads, and followed again as soon as
  it answers.
- Each registration is a new entry in the list of applications of the box;
  you can delete the old ones in the Hue Sync app.

## Security

The box answers in HTTPS with a certificate issued by the Philips Hue Sync
Box authority. The integration trusts **that authority only**, for these
requests only, and checks that the certificate names **the box it
registered** (its unique id, on its label): another device, or another box
at the same address, is refused. The access token given by the box at the
registration is kept in the configuration of the integration, never shown in
the screens nor written in the logs.

## Troubleshooting

- **"No button press seen"**: click **Register a Sync Box** again and hold
  the button until the light blinks green (a short press does nothing). If
  the light sync is running, stop it first.
- **"No Sync Box found"**: type the address of the box (see above). Check
  that Gladys and the box are on the same network.
- **"Registration refused"**: the registration was deleted in the Hue Sync
  app or the box was reset; register again.
- **Unreachable**: the box is unplugged, out of Wi-Fi reach, or has a new
  address (Gladys looks for it again by mDNS every 5 minutes; a new
  Discovery scan does it at once).
- **"Entertainment area is busy"**: the Hue bridge is not connected to the
  box, or another application holds the area; check in the Hue Sync app.
- Logs: the log level of the integration is set with the `LOG_LEVEL`
  variable.

## Privacy

The integration only talks to your Sync Boxes, on your local network, without
any account.
