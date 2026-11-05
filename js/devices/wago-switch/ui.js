/*
 * WAGO switch UI helpers shared by the WAGO views: VLAN colors and chips, port labels.
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

  /** Chip "VLAN 3 · Name"; `opts.tagged` adds a "T" marker, `opts.short` omits the name. */
  function vlanChip(config, id, opts) {
    const options = opts || {};
    const vlan = vlanById(config, id);
    const name = vlan && vlan.name ? vlan.name : '';
    return h('span', {
      class: 'chip chip-vlan' + (options.tagged ? ' chip-vlan-tagged' : ''),
      style: { '--chip': vlanColor(config, id) },
      title: 'VLAN ' + id + (name ? ' · ' + name : '') + (options.tagged ? ' (tagged)' : '') + (vlan ? '' : ' – not defined in config'),
    },
    h('span', { class: 'chip-dot' }),
    String(id),
    !options.short && name ? h('span', { class: 'chip-vlan-name' }, name) : null,
    options.tagged ? h('span', { class: 'chip-vlan-tag' }, 'T') : null);
  }

  function vlanChips(config, ids, opts) {
    if (!ids || !ids.length) return h('span', { class: 'muted' }, ui.EMPTY);
    return ids.map(function (id) { return vlanChip(config, id, opts); });
  }

  const MEDIA_LABEL = { sfp: 'SFP', 100: '10/100', 1000: '10/100/1000', 10000: '10G' };

  function mediaLabel(port) {
    return MEDIA_LABEL[port.media] || '';
  }

  const FRAMES_LABEL = { all: 'All', tagged: 'Tagged only', untagged: 'Untagged only' };

  function framesLabel(value) {
    return FRAMES_LABEL[value] || value;
  }

  /** "1-8, 10" from [1..8, 10]. */
  function portRanges(ports) {
    const out = [];
    let start = null;
    let prev = null;
    ports.forEach(function (p) {
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

  RouterLens.wagoUi = {
    vlanColor: vlanColor,
    vlanById: vlanById,
    vlanChip: vlanChip,
    vlanChips: vlanChips,
    mediaLabel: mediaLabel,
    framesLabel: framesLabel,
    portRanges: portRanges,
  };
})(window);
