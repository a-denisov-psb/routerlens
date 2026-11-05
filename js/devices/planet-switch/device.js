/*
 * Device module: PLANET managed switches (GS-4210 series, "running-config.cfg" CLI export).
 * Parser: ./parser.js (RouterLens.planetSwitch), shared UI: ./ui.js (RouterLens.planetUi),
 * views: ./views/*.js (device 'planet-switch').
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;

  RouterLens.devices.register({
    id: 'planet-switch',
    label: 'PLANET managed switch',
    fileLabel: 'a PLANET switch config (running-config.cfg)',
    extensions: ['.cfg', '.txt', '.conf'],
    open: function (text, file) {
      if (!RouterLens.planetSwitch.detect(text)) return null;
      try {
        return RouterLens.planetSwitch.parseConfig(text);
      } catch (err) {
        throw new Error('Could not parse "' + file.name + '": ' + err.message);
      }
    },
    hostname: function (config) {
      return config.system.name || config.management.address || (config.model ? 'PLANET ' + config.model : null);
    },
  });
})(window);
