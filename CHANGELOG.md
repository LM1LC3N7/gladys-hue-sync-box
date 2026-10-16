# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- One device per Philips Hue Play HDMI Sync Box, over its official local API
  (HTTPS): power (on / power save), light sync, mode (power save,
  passthrough, video, music, game), intensity of each sync mode, brightness
  (50 % = as the source), HDMI input (with the names given in the Hue Sync
  app) and Hue entertainment area.
- "Register a Sync Box" button: every box found and not registered waits for
  its button to be held; the access token is stored by the integration,
  never shown.
- Discovery over mDNS (`_huesync._tcp`) through Gladys, plus typed
  addresses; a box with a new address is found again by mDNS.
- State read every 5 seconds (2-60, configurable) and right after each
  command, only the changed values sent to Gladys; unreachable after three
  failed reads, with a badge.
- HTTPS trusting only the Sync Box root CA published by Philips Hue, and
  only the registered box (unique id in its certificate).
- Scene triggers "mode changed" and "HDMI input changed", silent for the
  changes made through Gladys.
- Scene actions "start the light sync" (mode, intensity, input, brightness,
  area), "stop the light sync", "switch the HDMI input" and "read the state".
- "Test the boxes" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-hue-sync-box/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-hue-sync-box/releases/tag/v0.1.1
