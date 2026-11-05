/*
 * Device module: WAGO managed switches (852 series, "config.save" CLI export).
 * Parser: ./parser.js (RouterLens.wagoSwitch), shared UI: ./ui.js (RouterLens.wagoUi),
 * views: ./views/*.js (device 'wago-switch').
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;

  RouterLens.devices.register({
    id: 'wago-switch',
    label: 'WAGO managed switch',
    fileLabel: 'a WAGO switch config (config.save)',
    extensions: ['.save', '.txt', '.cfg', '.conf'],
    open: function (text, file) {
      if (!RouterLens.wagoSwitch.detect(text)) return null;
      try {
        return RouterLens.wagoSwitch.parseConfig(text);
      } catch (err) {
        throw new Error('Could not parse "' + file.name + '": ' + err.message);
      }
    },
    /** The export has no hostname; the management address identifies the switch best. */
    hostname: function (config) {
      const mgmt = config.management.find(function (m) { return m.settings.address; });
      if (mgmt) return mgmt.settings.address.replace(/\/\d+$/, '');
      return config.model ? 'WAGO ' + config.model : null;
    },
  });
})(window);
