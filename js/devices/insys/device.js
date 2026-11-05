/*
 * Device module: INSYS icom OS routers (flat key=value config export).
 * Parser: ./parser.js (RouterLens.insys), views: ./views/*.js (device 'insys').
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;

  RouterLens.devices.register({
    id: 'insys',
    label: 'INSYS icom OS',
    fileLabel: 'an INSYS icom OS export (.txt)',
    extensions: ['.txt', '.cfg', '.conf'],
    open: function (text, file) {
      let config;
      try {
        config = RouterLens.insys.parseConfig(text);
      } catch (err) {
        throw new Error('Could not parse "' + file.name + '": ' + err.message);
      }
      return config.values.size ? config : null;
    },
    hostname: function (config) { return config.get('administration.hostnames.hostname'); },
  });
})(window);
