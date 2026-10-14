/*
 * Securepoint-specific UI helpers shared by the Securepoint views:
 * zone chips, permission labels and small formatters.
 */
(function (root) {
  'use strict';

  const RouterLens = (root.RouterLens = root.RouterLens || {});
  const h = RouterLens.ui.h;
  const ui = RouterLens.ui;

  const PERMISSION_LABEL = {
    ADMIN: 'Administrator',
    VPN_OPENVPN: 'SSL-VPN (OpenVPN)',
    VPN_L2TP: 'L2TP VPN',
    VPN_IPSEC: 'IPsec VPN',
  };

  function permissionLabel(permission) {
    if (!permission) return '';
    return PERMISSION_LABEL[permission] || permission;
  }

  /** Color token (CSS variable) per zone: firewall-side zones are muted, VPN zones violet, etc. */
  function zoneColor(name) {
    if (/^firewall-/.test(name)) return 'var(--muted)';
    if (/^vpn-/.test(name)) return 'var(--violet)';
    if (name === 'external') return 'var(--rose)';
    if (name === 'internal') return 'var(--on)';
    return 'var(--primary)';
  }

  function zoneChip(name) {
    return h('span', { class: 'chip', style: { '--chip': zoneColor(name) }, title: 'Zone' },
      h('span', { class: 'chip-dot' }), name);
  }

  function zoneChips(names) {
    if (!names || !names.length) return h('span', { class: 'muted' }, ui.EMPTY);
    return names.map(zoneChip);
  }

  /** Text for the empty "n/a" style cell. */
  function dash() {
    return h('span', { class: 'muted' }, ui.EMPTY);
  }

  function orDash(value) {
    return value === undefined || value === null || value === '' ? dash() : value;
  }

  /** Splits "a.b.c.d/24" into { ip, bits }. */
  function splitCidr(cidr) {
    const m = /^(.+)\/(\d+)$/.exec(cidr || '');
    return m ? { ip: m[1], bits: Number(m[2]) } : { ip: cidr || '', bits: null };
  }

  RouterLens.spui = {
    permissionLabel: permissionLabel,
    zoneColor: zoneColor,
    zoneChip: zoneChip,
    zoneChips: zoneChips,
    dash: dash,
    orDash: orDash,
    splitCidr: splitCidr,
  };
})(window);
