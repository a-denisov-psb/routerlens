/*
 * WAGO switch VLANs: membership matrix (VLAN × port: untagged / tagged / forbidden, PVID marked)
 * and the per-port VLAN settings table.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const wui = RouterLens.wagoUi;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="15" width="18" height="5" rx="1"/>' +
    '<path d="M7 9v6M12 9v6M17 9v6"/></svg>';

  function render(config) {
    return h('div', { class: 'routing' },
      matrixCard(config),
      portsCard(config));
  }

  /* ---------- Matrix ---------- */

  function cellFor(config, vlan, port) {
    const tagged = vlan.tagged.indexOf(port.number) !== -1;
    const member = vlan.fixed.indexOf(port.number) !== -1 || (vlan.untagged && vlan.untagged.indexOf(port.number) !== -1);
    const forbidden = vlan.forbidden.indexOf(port.number) !== -1;
    const isPvid = port.pvid === vlan.id;

    let mark = null;
    let label = 'Not a member';
    if (member && tagged) {
      mark = h('span', { class: 'vm-cell vm-tagged' }, 'T');
      label = 'Tagged member';
    } else if (member) {
      mark = h('span', { class: 'vm-cell vm-untagged' }, 'U');
      label = 'Untagged member';
    } else if (forbidden) {
      mark = h('span', { class: 'vm-cell vm-forbidden' }, '×');
      label = 'Forbidden';
    } else {
      mark = h('span', { class: 'vm-cell vm-none' });
    }
    if (isPvid) label += ' · PVID';
    return h('td', {
      class: 'vm-td' + (isPvid ? ' vm-pvid' : ''),
      style: { '--chip': wui.vlanColor(config, vlan.id) },
      title: 'VLAN ' + vlan.id + ', port ' + port.number + ': ' + label,
    }, mark);
  }

  function matrixCard(config) {
    if (!config.vlans.length || !config.ports.length) {
      return ui.card({ title: 'VLAN membership', body: ui.emptyNote('No VLANs configured.') });
    }
    const head = h('tr', null,
      h('th', { class: 'vm-vlan-col' }, 'VLAN'),
      config.ports.map(function (p) {
        return h('th', { class: 'vm-port', title: p.name }, h('span', { class: 'port-badge' }, String(p.number)),
          h('span', { class: 'vm-media' }, wui.mediaLabel(p)));
      }));
    const rows = config.vlans.map(function (v) {
      return h('tr', null,
        h('th', { class: 'vm-vlan-col', scope: 'row' }, wui.vlanChip(config, v.id)),
        config.ports.map(function (p) { return cellFor(config, v, p); }));
    });
    const legend = h('div', { class: 'vm-legend' },
      h('span', null, h('span', { class: 'vm-cell vm-untagged', style: { '--chip': 'var(--text-2)' } }, 'U'), 'Untagged'),
      h('span', null, h('span', { class: 'vm-cell vm-tagged', style: { '--chip': 'var(--text-2)' } }, 'T'), 'Tagged'),
      config.vlans.some(function (v) { return v.forbidden.length; })
        ? h('span', null, h('span', { class: 'vm-cell vm-forbidden' }, '×'), 'Forbidden') : null,
      h('span', null, h('span', { class: 'vm-pvid-sample' }), 'PVID of the port'));

    return ui.card({
      title: 'VLAN membership',
      subtitle: 'Which VLANs each port carries, and how',
      body: [h('div', { class: 'table-wrap' }, h('table', { class: 'table vlan-matrix' }, h('thead', null, head), h('tbody', null, rows))), legend],
    });
  }

  /* ---------- Port table ---------- */

  function portsCard(config) {
    const rows = config.ports.map(function (p) {
      const notes = [];
      if (!p.pvidMember) notes.push(h('span', { class: 'pill pill-warn', title: 'Untagged frames received on this port go to a VLAN the port does not send untagged' }, 'PVID not untagged member'));
      if (p.ring) notes.push(h('span', { class: 'pill ' + (p.ring.enabled ? 'pill-info' : 'pill-off') }, 'MRP ring ' + p.ring.id + (p.ring.enabled ? '' : ' (disabled)')));
      if (p.shutdown) notes.push(h('span', { class: 'pill pill-off' }, 'Shutdown'));
      if (p.forbidden.length) notes.push(h('span', { class: 'pill pill-off' }, 'Forbidden: ' + p.forbidden.join(', ')));
      return h('tr', null,
        h('td', null, h('span', { class: 'port-badge' }, String(p.number))),
        h('td', null, h('code', null, p.name), p.description ? h('div', { class: 'muted' }, p.description) : null),
        h('td', { class: 'muted' }, wui.mediaLabel(p) || ui.EMPTY),
        h('td', { class: 'nowrap' }, wui.vlanChip(config, p.pvid), p.pvidConfigured ? null : h('span', { class: 'muted', title: 'Not set in the config, switch default' }, 'default')),
        h('td', null, wui.vlanChips(config, p.untagged)),
        h('td', null, wui.vlanChips(config, p.tagged)),
        h('td', { class: p.acceptableFramesConfigured ? null : 'muted' }, wui.framesLabel(p.acceptableFrames)),
        h('td', null, notes.length ? notes : h('span', { class: 'muted' }, ui.EMPTY)));
    });
    return ui.card({
      title: 'Port VLAN settings',
      body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', null, 'Port'), h('th', null, 'Interface'), h('th', null, 'Media'), h('th', null, 'PVID'),
          h('th', null, 'Untagged'), h('th', null, 'Tagged'), h('th', null, 'Accepted frames'), h('th', null, 'Notes'))),
        h('tbody', null, rows))),
    });
  }

  RouterLens.views.register({ id: 'vlans', label: 'VLANs', icon: ICON, device: 'wago-switch', render: render });
})(window);
