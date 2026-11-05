/*
 * PLANET switch dashboard: system / management settings, access (users, SNMP, web), PoE,
 * VLAN overview and the front panel with every port's mode, VLANs and PoE state. Statements
 * the parser does not interpret are listed in an "Other settings" card, so nothing goes unseen.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const pui = RouterLens.planetUi;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
    '<rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

  function render(config) {
    return h('div', { class: 'dashboard' },
      h('div', { class: 'grid' },
        systemCard(config),
        accessCard(config),
        poeCard(config),
        vlanCard(config),
        portsCard(config),
        otherCard(config)));
  }

  function code(value) {
    return value ? h('code', null, value) : undefined;
  }

  function onOff(value) {
    if (value === null || value === undefined) return undefined;
    return ui.flag(value ? '1' : '0');
  }

  /* ---------- System / management ---------- */

  function systemCard(config) {
    const m = config.management;
    const body = [
      m.address
        ? h('ul', { class: 'addr-list' }, h('li', { class: 'addr' },
          h('code', { class: 'addr-ip' }, m.address),
          m.mask ? h('span', { class: 'addr-mask' }, pui.maskLabel(m.mask)) : null,
          h('span', { class: 'addr-desc' }, 'Management')))
        : null,
      ui.kvList([
        ['System name', config.system.name || undefined],
        ['Model', code(config.model)],
        ['Device', config.modelDescription || config.system.description || undefined],
        ['Firmware', code(config.system.version)],
        ['Up time at export', config.system.uptime || undefined],
        ['DHCP client', m.dhcp ? onOff(true) : undefined],
        ['Default gateway', code(m.gateway)],
        ['DNS servers', m.dns.length ? m.dns.map(function (d) { return h('code', { class: 'planet-list-item' }, d); }) : undefined],
      ]),
    ];
    return ui.card({ title: 'System', className: 'card-system', body: body });
  }

  /* ---------- Access: users, SNMP, web, spanning tree ---------- */

  const CREDENTIAL_LABEL = {
    'secret-encrypted': 'Encrypted secret',
    secret: 'Secret',
    'password-encrypted': 'Encrypted password',
    password: 'Plaintext password',
    none: 'No password',
  };

  function accessCard(config) {
    const users = config.users.length
      ? h('ul', { class: 'planet-users' }, config.users.map(function (u) {
        return h('li', null,
          h('span', { class: 'planet-user-name' }, u.name),
          u.privilege !== null ? h('span', { class: 'muted' }, 'privilege ' + u.privilege) : null,
          h('span', { class: 'pill ' + (u.credential === 'password' || u.credential === 'none' ? 'planet-pill-warn' : 'pill-off') }, CREDENTIAL_LABEL[u.credential]));
      }))
      : undefined;

    // Community names are credentials: only their access level is shown, plus a warning for defaults.
    const snmp = config.snmp.communities.length
      ? config.snmp.communities.map(function (c) {
        return h('span', { class: 'planet-community' },
          h('span', { class: 'pill pill-off' }, c.access === 'rw' ? 'Read-write' : 'Read-only'),
          c.wellKnown ? h('span', { class: 'pill planet-pill-warn', title: 'The community uses a well-known default name (public / private)' }, 'Default name') : null);
      })
      : undefined;

    const st = config.spanningTree;
    return ui.card({
      title: 'Management access',
      body: ui.kvList([
        ['Users', users],
        ['SNMP', config.snmp.enabled !== null ? onOff(config.snmp.enabled) : undefined],
        ['SNMP communities', snmp],
        ['HTTP → HTTPS redirect', onOff(config.services.httpSecureRedirect)],
        ['Spanning tree', st.enabled !== null ? onOff(st.enabled) : undefined],
        ['STP mode', st.mode ? st.mode.toUpperCase() : undefined],
        ['MST region', st.mstName ? h('code', null, st.mstName) : undefined],
        ['MST revision', st.mstRevision !== null ? String(st.mstRevision) : undefined],
        ['Voice VLAN', config.voiceVlan.vlan !== null ? pui.vlanChip(config, config.voiceVlan.vlan) : undefined],
        ['Voice VLAN OUIs', config.voiceVlan.oui.length
          ? h('span', { title: config.voiceVlan.oui.map(function (o) { return o.oui + ' ' + o.description; }).join('\n') },
            config.voiceVlan.oui.map(function (o) { return o.description || o.oui; }).join(', '))
          : undefined],
      ]),
    });
  }

  /* ---------- PoE ---------- */

  function poeCard(config) {
    const poePorts = config.ports.filter(function (p) { return p.poe; });
    if (!poePorts.length && !config.poe.adminMode) return null;
    const enabled = poePorts.filter(function (p) { return p.poe.enabled === true; }).map(function (p) { return p.number; });
    const disabled = poePorts.filter(function (p) { return p.poe.enabled === false; }).map(function (p) { return p.number; });
    const byPriority = {};
    poePorts.forEach(function (p) {
      if (!p.poe.priority) return;
      (byPriority[p.poe.priority] = byPriority[p.poe.priority] || []).push(p.number);
    });
    const adminOn = config.poe.adminMode === null ? null : config.poe.adminMode === 'enable';

    return ui.card({
      title: 'PoE',
      inactive: adminOn === false,
      aside: adminOn !== null ? h('span', { class: 'pill ' + (adminOn ? 'pill-on' : 'pill-off') }, adminOn ? 'Enabled' : 'Disabled') : null,
      body: ui.kvList([
        ['Power limit mode', config.poe.limitMode ? config.poe.limitMode.charAt(0).toUpperCase() + config.poe.limitMode.slice(1) : undefined],
        ['Temperature threshold', config.poe.temperatureThreshold !== null ? config.poe.temperatureThreshold + ' °C' : undefined],
        ['Ports enabled', enabled.length ? pui.ranges(enabled) : ''],
        ['Ports disabled', disabled.length ? pui.ranges(disabled) : undefined],
      ].concat(['critical', 'high', 'medium', 'low'].filter(function (k) { return byPriority[k]; }).map(function (k) {
        return ['Priority ' + pui.poePriorityLabel(k).toLowerCase(), pui.ranges(byPriority[k])];
      })).concat([
        ['Other', config.poe.other.length ? h('pre', { class: 'note-text' }, config.poe.other.join('\n')) : undefined],
      ])),
    });
  }

  /* ---------- VLAN overview ---------- */

  function vlanCard(config) {
    if (!config.vlans.length) return ui.card({ title: 'VLANs', body: ui.emptyNote('No VLANs configured.') });
    const rows = config.vlans.map(function (v) {
      const untagged = config.ports.filter(function (p) { return p.untagged.indexOf(v.id) !== -1; }).map(function (p) { return p.number; });
      const tagged = config.ports.filter(function (p) { return p.tagged.indexOf(v.id) !== -1; }).map(function (p) { return p.number; });
      return h('tr', null,
        h('td', null, pui.vlanChip(config, v.id)),
        h('td', null, untagged.length ? pui.ranges(untagged) : h('span', { class: 'muted' }, ui.EMPTY)),
        h('td', null, tagged.length ? pui.ranges(tagged) : h('span', { class: 'muted' }, ui.EMPTY)));
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
    const pvidVlan = pui.vlanById(config, port.pvid);
    const hints = [pui.poeBadge(port)];
    if (port.shutdown) hints.push(h('span', { class: 'badge planet-badge-shutdown' }, 'Shutdown'));
    if (port.undefinedVlans.length) hints.push(h('span', { class: 'badge planet-badge-warn', title: 'VLAN ' + port.undefinedVlans.join(', ') + ' not defined in config' }, 'Undefined VLAN'));

    return h('div', {
      class: 'planet-port' + (port.media === 'sfp' ? ' planet-port-sfp' : '') + (port.shutdown ? ' planet-port-off' : ''),
      style: { '--chip': pui.vlanColor(config, port.pvid) },
      title: port.name + (port.description ? ' · ' + port.description : ''),
    },
    h('div', { class: 'planet-port-head' },
      h('span', { class: 'planet-port-number' }, String(port.number)),
      h('span', { class: 'planet-port-media' }, pui.mediaLabel(port))),
    port.description ? h('div', { class: 'planet-port-desc' }, port.description) : null,
    h('div', { class: 'planet-port-row' }, pui.modeBadge(port)),
    h('div', { class: 'planet-port-row' },
      h('span', { class: 'planet-port-label' }, port.mode === 'trunk' ? 'Native' : port.mode === 'access' ? 'VLAN' : 'PVID'),
      pui.vlanChip(config, port.pvid, { short: !pvidVlan || !pvidVlan.name })),
    port.tagged.length
      ? h('div', { class: 'planet-port-row' },
        h('span', { class: 'planet-port-label' }, 'Tagged'),
        pui.vlanChips(config, port.tagged, { short: true }))
      : null,
    hints.filter(Boolean).length ? h('div', { class: 'planet-port-hints' }, hints) : null);
  }

  function portsCard(config) {
    if (!config.ports.length) return ui.card({ title: 'Ports', className: 'card-ports', body: ui.emptyNote('No ports in this config.') });
    return ui.card({
      title: 'Ports',
      subtitle: 'VLAN mode, untagged and tagged VLANs and PoE per port',
      className: 'card-ports',
      body: h('div', { class: 'planet-panel' }, config.ports.map(function (p) { return portTile(config, p); })),
    });
  }

  /* ---------- Uninterpreted statements ---------- */

  function otherCard(config) {
    const groups = [];
    if (config.otherGlobals.length) groups.push(['Global', config.otherGlobals]);
    if (config.spanningTree.other.length) groups.push(['Spanning tree', config.spanningTree.other]);
    if (config.voiceVlan.other.length) groups.push(['Voice VLAN', config.voiceVlan.other]);
    if (config.services.other.length) groups.push(['Services', config.services.other]);
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

  RouterLens.views.register({ id: 'dashboard', label: 'Dashboard', icon: ICON, device: 'planet-switch', render: render });
})(window);
