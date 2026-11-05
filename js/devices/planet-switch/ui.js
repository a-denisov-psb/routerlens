/*
 * PLANET switch UI helpers shared by the PLANET views: VLAN colors and chips, port labels.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const h = ui.h;

  const PALETTE = ['var(--primary)', 'var(--violet)', 'var(--on)', 'var(--rose)', 'var(--warn)'];

  /** VLAN 1 (the default VLAN) is neutral; the others cycle through the palette by position. */
  function vlanColor(config, id) {
    if (id === 1) return 'var(--off)';
    const others = config.vlans.filter(function (v) { return v.id !== 1; });
    const index = others.findIndex(function (v) { return v.id === id; });
    return PALETTE[(index === -1 ? id : index) % PALETTE.length];
  }

  function vlanById(config, id) {
    return config.vlans.find(function (v) { return v.id === id; }) || null;
  }

  /** Chip "20 · Name"; `opts.tagged` adds a "T" marker, `opts.short` omits the name. */
  function vlanChip(config, id, opts) {
    const options = opts || {};
    const vlan = vlanById(config, id);
    const name = vlan && vlan.name ? vlan.name : '';
    return h('span', {
      class: 'chip planet-vlan' + (options.tagged ? ' planet-vlan-tagged' : '') + (vlan ? '' : ' planet-vlan-undefined'),
      style: { '--chip': vlanColor(config, id) },
      title: 'VLAN ' + id + (name ? ' · ' + name : '') + (options.tagged ? ' (tagged)' : '') + (vlan ? '' : ' – not defined in config'),
    },
    h('span', { class: 'chip-dot' }),
    String(id),
    !options.short && name ? h('span', { class: 'planet-vlan-name' }, name) : null,
    options.tagged ? h('span', { class: 'planet-vlan-tag' }, 'T') : null);
  }

  function vlanChips(config, ids, opts) {
    if (!ids || !ids.length) return h('span', { class: 'muted' }, ui.EMPTY);
    return ids.map(function (id) { return vlanChip(config, id, opts); });
  }

  const MEDIA_LABEL = { sfp: 'SFP', 100: '10/100', 1000: '10/100/1000', 10000: '10G', lag: 'LAG' };

  function mediaLabel(port) {
    return MEDIA_LABEL[port.media] || '';
  }

  const MODE_LABEL = { access: 'Access', trunk: 'Trunk', hybrid: 'Hybrid', general: 'General', tunnel: 'Tunnel' };

  function modeLabel(mode) {
    return MODE_LABEL[mode] || mode;
  }

  /** Mode badge; a mode the config does not set is the switch default and marked as such. */
  function modeBadge(port) {
    return h('span', {
      class: 'badge planet-mode planet-mode-' + port.mode + (port.modeConfigured ? '' : ' planet-mode-default'),
      title: port.modeConfigured ? 'switchport mode ' + port.mode : 'Not set in the config: switch default (' + port.mode + ')',
    }, modeLabel(port.mode));
  }

  const PRIORITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

  function poePriorityLabel(priority) {
    return PRIORITY_LABEL[priority] || priority || '';
  }

  /** PoE state of a port as badge, or null when the port has no PoE. */
  function poeBadge(port) {
    if (!port.poe) return null;
    const enabled = port.poe.enabled === true;
    const title = port.poe.enabled === null
      ? 'PoE not set in the config (switch default)'
      : 'PoE ' + (enabled ? 'enabled' : 'disabled') + (port.poe.priority ? ', priority ' + port.poe.priority : '');
    return h('span', { class: 'badge ' + (enabled ? 'planet-poe-on' : 'planet-poe-off'), title: title },
      'PoE' + (port.poe.enabled === false ? ' off' : '') + (enabled && port.poe.priority ? ' · ' + poePriorityLabel(port.poe.priority) : ''));
  }

  /** "1-8, 10" from [1..8, 10]. */
  function ranges(numbers) {
    const out = [];
    let start = null;
    let prev = null;
    numbers.forEach(function (p) {
      if (start === null) {
        start = prev = p;
      } else if (p === prev + 1) {
        prev = p;
      } else {
        out.push(start === prev ? String(start) : start + '-' + prev);
        start = prev = p;
      }
    });
    if (start !== null) out.push(start === prev ? String(start) : start + '-' + prev);
    return out.join(', ');
  }

  /** Short subnet notation: "255.255.255.0" → "/24 (255.255.255.0)". */
  function maskLabel(mask) {
    if (!mask) return '';
    if (/^\d{1,2}$/.test(mask)) return ui.formatNetmask(mask);
    const octets = mask.split('.').map(Number);
    if (octets.length !== 4 || octets.some(function (o) { return isNaN(o); })) return mask;
    const bits = octets.reduce(function (sum, o) { return sum + (o.toString(2).match(/1/g) || []).length; }, 0);
    return '/' + bits + ' (' + mask + ')';
  }

  RouterLens.planetUi = {
    vlanColor: vlanColor,
    vlanById: vlanById,
    vlanChip: vlanChip,
    vlanChips: vlanChips,
    mediaLabel: mediaLabel,
    modeLabel: modeLabel,
    modeBadge: modeBadge,
    poeBadge: poeBadge,
    poePriorityLabel: poePriorityLabel,
    ranges: ranges,
    maskLabel: maskLabel,
  };
})(window);
