// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Commands --------------------------------------------------------------------
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- Scene actions ---------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTIONS.START_SYNC, (fields) => app.startSync(fields));
  gladys.onSceneAction(SCENE_ACTIONS.STOP_SYNC, (fields) => app.stopSync(fields));
  gladys.onSceneAction(SCENE_ACTIONS.SWITCH_INPUT, (fields) => app.switchInput(fields));
  gladys.onSceneAction(SCENE_ACTIONS.GET_STATE, (fields) => app.getState(fields));

  // --- Configuration screen buttons ------------------------------------------------
  gladys.onAction(ACTIONS.REGISTER, (fields) => app.register(fields));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration changed by the user -------------------------------------------
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated');
    return app.start(config);
  });

  // --- Connection lifecycle: (re)start on every connection, pause while Gladys is away.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
