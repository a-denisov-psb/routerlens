/*
 * PLANET switch VLANs: membership matrix (VLAN × port: untagged / tagged, PVID marked) and the
 * per-port table (mode, PVID / native VLAN, untagged / tagged VLANs, PoE, notes).
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const pui = RouterLens.planetUi;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/>' +
    '<path d="M7 9v6M12 9v6M17 9v6"/></svg>';

  function render(config) {
    return h('div', { class: 'routing' },
      matrixCard(config),
      portsCard(config));
  }

  /** Every VLAN a port carries, also those not defined in the config (shown as extra rows). */
  function matrixVlans(config) {
    const ids = config.vlans.map(function (v) { return v.id; });
    config.ports.forEach(function (p) {
      p.untagged.concat(p.tagged).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    });
    return ids.sort(function (a, b) { return a - b; });
  }

  /* ---------- Matrix ---------- */

  function cellFor(config, vlanId, port) {
    const tagged = port.tagged.indexOf(vlanId) !== -1;
    const untagged = port.untagged.indexOf(vlanId) !== -1;
    const isPvid = port.pvid === vlanId;

    let mark;
    let label = 'Not a member';
    if (tagged) {
      mark = h('span', { class: 'planet-cell planet-cell-tagged' }, 'T');
      label = 'Tagged member';
    } else if (untagged) {
      mark = h('span', { class: 'planet-cell planet-cell-untagged' }, 'U');
      label = 'Untagged member';
    } else {
      mark = h('span', { class: 'planet-cell planet-cell-none' });
    }
    if (isPvid) label += ' · PVID';
    return h('td', {
      class: 'planet-td' + (isPvid ? ' planet-pvid' : ''),
      style: { '--chip': pui.vlanColor(config, vlanId) },
      title: 'VLAN ' + vlanId + ', port ' + port.number + ': ' + label,
    }, mark);
  }

  function matrixCard(config) {
    const vlanIds = matrixVlans(config);
    if (!vlanIds.length || !config.ports.length) {
      return ui.card({ title: 'VLAN membership', body: ui.emptyNote('No VLANs configured.') });
    }
    const head = h('tr', null,
      h('th', { class: 'planet-vlan-col' }, 'VLAN'),
      config.ports.map(function (p) {
        return h('th', { class: 'planet-port-col', title: p.name + (p.description ? ' · ' + p.description : '') },
          h('span', { class: 'port-badge' }, String(p.number)),
          h('span', { class: 'planet-col-media' }, pui.mediaLabel(p) === 'SFP' ? 'SFP' : ''));
      }));
    const rows = vlanIds.map(function (id) {
      return h('tr', null,
        h('th', { class: 'planet-vlan-col', scope: 'row' }, pui.vlanChip(config, id)),
        config.ports.map(function (p) { return cellFor(config, id, p); }));
    });
    const legend = h('div', { class: 'planet-legend' },
      h('span', null, h('span', { class: 'planet-cell planet-cell-untagged', style: { '--chip': 'var(--text-2)' } }, 'U'), 'Untagged'),
      h('span', null, h('span', { class: 'planet-cell planet-cell-tagged', style: { '--chip': 'var(--text-2)' } }, 'T'), 'Tagged'),
      h('span', null, h('span', { class: 'planet-pvid-sample' }), 'PVID / native VLAN of the port'));

    return ui.card({
      title: 'VLAN membership',
      subtitle: 'Which VLANs each port carries, and how',
      body: [h('div', { class: 'table-wrap' }, h('table', { class: 'table planet-matrix' }, h('thead', null, head), h('tbody', null, rows))), legend],
    });
  }

  /* ---------- Port table ---------- */

  function portsCard(config) {
    const rows = config.ports.map(function (p) {
      const notes = [];
      if (!p.pvidMember) notes.push(h('span', { class: 'pill planet-pill-warn', title: 'Untagged frames received on this port go to a VLAN the port does not send untagged' }, 'PVID not untagged member'));
      if (p.undefinedVlans.length) notes.push(h('span', { class: 'pill planet-pill-warn' }, 'VLAN ' + p.undefinedVlans.join(', ') + ' not defined'));
      if (p.shutdown) notes.push(h('span', { class: 'pill pill-off' }, 'Shutdown'));
      if (p.other.length) notes.push(h('span', { class: 'pill pill-off', title: p.other.join('\n') }, p.other.length + ' other setting' + (p.other.length > 1 ? 's' : '')));
      return h('tr', null,
        h('td', null, h('span', { class: 'port-badge' }, String(p.number))),
        h('td', null, h('code', null, p.name), p.description ? h('div', { class: 'muted' }, p.description) : null),
        h('td', { class: 'muted' }, pui.mediaLabel(p) || ui.EMPTY),
        h('td', null, pui.modeBadge(p)),
        h('td', { class: 'planet-nowrap' }, pui.vlanChip(config, p.pvid)),
        h('td', null, pui.vlanChips(config, p.untagged)),
        h('td', null, pui.vlanChips(config, p.tagged)),
        h('td', null, pui.poeBadge(p) || h('span', { class: 'muted' }, ui.EMPTY)),
        h('td', null, notes.length ? notes : h('span', { class: 'muted' }, ui.EMPTY)));
    });
    return ui.card({
      title: 'Port VLAN settings',
      subtitle: 'Modes not set in the config are the switch default (trunk, native VLAN 1)',
      body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Port'), h('th', null, 'Interface'), h('th', null, 'Media'), h('th', null, 'Mode'),
          h('th', null, 'PVID'), h('th', null, 'Untagged'), h('th', null, 'Tagged'), h('th', null, 'PoE'), h('th', null, 'Notes'))),
        h('tbody', null, rows))),
    });
  }

  RouterLens.views.register({ id: 'vlans', label: 'VLANs', icon: ICON, device: 'planet-switch', render: render });
})(window);
