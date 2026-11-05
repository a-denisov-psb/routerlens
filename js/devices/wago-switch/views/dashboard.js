/*
 * WAGO switch dashboard: system / management settings, ring redundancy (MRP), VLAN overview
 * and the front panel with every port's VLAN setup. Statements the parser does not interpret
 * are listed in an "Other settings" card, so nothing in the export goes unseen.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const wui = RouterLens.wagoUi;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
    '<rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

  const FEATURE_LABEL = { profinet: 'PROFINET', lldp: 'LLDP' };

  function render(config) {
    return h('div', { class: 'dashboard' },
      h('div', { class: 'grid' },
        systemCard(config),
        config.rings.map(function (r) { return ringCard(config, r); }),
        vlanCard(config),
        portsCard(config),
        otherCard(config)));
  }

  /* ---------- System / management ---------- */

  function featureFlag(enabled) {
    return ui.flag(enabled ? '1' : '0');
  }

  function systemCard(config) {
    const mgmt = config.management[0];
    const s = mgmt ? mgmt.settings : {};
    const featureRows = Object.keys(config.features).map(function (key) {
      return [FEATURE_LABEL[key] || key, featureFlag(config.features[key])];
    });
    const body = [
      s.address
        ? h('ul', { class: 'addr-list' }, h('li', { class: 'addr' },
          h('code', { class: 'addr-ip' }, s.address.replace(/\/\d+$/, '')),
          /\/(\d+)$/.test(s.address) ? h('span', { class: 'addr-mask' }, ui.formatNetmask(/\/(\d+)$/.exec(s.address)[1])) : null,
          h('span', { class: 'addr-desc' }, 'Management (' + (mgmt.name) + ')')))
        : null,
      ui.kvList([
        ['Model', config.model ? h('code', null, config.model) : undefined],
        ['Device', config.modelDescription || undefined],
        ['DHCP client', s.dhcp ? featureFlag(true) : undefined],
        ['Default gateway', s.gateway ? h('code', null, s.gateway) : undefined],
      ].concat(featureRows)),
    ];
    return ui.card({ title: 'System', className: 'card-system', body: body });
  }

  /* ---------- MRP ring ---------- */

  function ringCard(config, ring) {
    const enabled = ring.enabled === true;
    return ui.card({
      title: 'Ring redundancy (MRP)',
      subtitle: 'Ring ' + ring.id,
      inactive: !enabled,
      aside: h('span', { class: 'pill ' + (enabled ? 'pill-on' : 'pill-off') }, enabled ? 'Enabled' : 'Disabled'),
      body: ui.kvList([
        ['Ring ports', ring.ports.length ? ring.ports.map(function (p) { return h('span', { class: 'port-badge' }, String(p)); }) : ''],
        ['Ring VLAN', ring.vlan !== null ? wui.vlanChip(config, ring.vlan) : undefined],
        ['Role', ring.role || undefined],
        ['Domain UUID', ring.uuid ? h('code', null, ring.uuid) : undefined],
        ['Other', ring.other.length ? ring.other.join('\n') : undefined],
      ]),
    });
  }

  /* ---------- VLAN overview ---------- */

  function vlanCard(config) {
    if (!config.vlans.length) return ui.card({ title: 'VLANs', body: ui.emptyNote('No VLANs configured.') });
    const rows = config.vlans.map(function (v) {
      const untagged = v.fixed.filter(function (p) { return v.tagged.indexOf(p) === -1; });
      return h('tr', null,
        h('td', null, wui.vlanChip(config, v.id)),
        h('td', null, untagged.length ? wui.portRanges(untagged) : h('span', { class: 'muted' }, ui.EMPTY)),
        h('td', null, v.tagged.length ? wui.portRanges(v.tagged) : h('span', { class: 'muted' }, ui.EMPTY)));
    });
    return ui.card({
      title: 'VLANs',
      aside: h('a', { class: 'link-btn', href: '#vlans' }, 'Matrix →'),
      body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'VLAN'), h('th', null, 'Untagged ports'), h('th', null, 'Tagged ports'))),
        h('tbody', null, rows))),
    });
  }

  /* ---------- Front panel ---------- */

  function portTile(config, port) {
    const pvidVlan = wui.vlanById(config, port.pvid);
    const hints = [];
    if (port.ring) hints.push(h('span', { class: 'badge ' + (port.ring.enabled ? 'badge-ring' : 'badge-note'), title: 'MRP ring ' + port.ring.id + (port.ring.enabled ? '' : ' (disabled)') }, 'MRP'));
    if (port.acceptableFramesConfigured && port.acceptableFrames !== 'all') hints.push(h('span', { class: 'badge badge-note', title: 'Acceptable frame type' }, wui.framesLabel(port.acceptableFrames)));
    if (port.shutdown) hints.push(h('span', { class: 'badge badge-shutdown' }, 'Shutdown'));

    return h('div', {
      class: 'port-tile' + (port.media === 'sfp' ? ' port-tile-sfp' : '') + (port.shutdown ? ' port-tile-off' : ''),
      style: { '--chip': wui.vlanColor(config, port.pvid) },
      title: port.name + (port.description ? ' · ' + port.description : ''),
    },
    h('div', { class: 'port-tile-head' },
      h('span', { class: 'port-tile-number' }, String(port.number)),
      h('span', { class: 'port-tile-media' }, wui.mediaLabel(port))),
    port.description ? h('div', { class: 'port-tile-desc' }, port.description) : null,
    h('div', { class: 'port-tile-row' },
      h('span', { class: 'port-tile-label' }, 'PVID'),
      wui.vlanChip(config, port.pvid, { short: !pvidVlan || !pvidVlan.name })),
    port.tagged.length
      ? h('div', { class: 'port-tile-row' },
        h('span', { class: 'port-tile-label' }, 'Tagged'),
        wui.vlanChips(config, port.tagged, { short: true }))
      : null,
    !port.pvidMember
      ? h('div', { class: 'port-tile-warn', title: 'The PVID is not an untagged VLAN of this port' }, 'PVID not untagged member')
      : null,
    hints.length ? h('div', { class: 'port-tile-hints' }, hints) : null);
  }

  function portsCard(config) {
    if (!config.ports.length) return ui.card({ title: 'Ports', className: 'card-ports', body: ui.emptyNote('No ports in this config.') });
    return ui.card({
      title: 'Ports',
      subtitle: 'Untagged VLAN (PVID) and tagged VLANs per port',
      className: 'card-ports',
      body: h('div', { class: 'port-panel' }, config.ports.map(function (p) { return portTile(config, p); })),
    });
  }

  /* ---------- Uninterpreted statements ---------- */

  function otherCard(config) {
    const groups = [];
    if (config.otherGlobals.length) groups.push(['Global', config.otherGlobals]);
    config.vlans.forEach(function (v) { if (v.other.length) groups.push(['vlan ' + v.id, v.other]); });
    config.interfaces.forEach(function (i) { if (i.other.length) groups.push(['interface ' + i.name, i.other]); });
    if (!groups.length) return null;
    return ui.card({
      title: 'Other settings',
      subtitle: 'Statements shown as exported',
      className: 'card-ports',
      body: ui.kvList(groups.map(function (g) { return [g[0], h('pre', { class: 'note-text' }, g[1].join('\n'))]; })),
    });
  }

  RouterLens.views.register({ id: 'dashboard', label: 'Dashboard', icon: ICON, device: 'wago-switch', render: render });
})(window);
