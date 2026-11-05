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

  /* ---------- Network objects and services ---------- */

  const KIND_LABEL = {
    any: 'Any',
    host: 'Host',
    network: 'Network',
    interface: 'Interface address',
    'interface-network': 'Interface network',
    geoip: 'GeoIP country',
    group: 'Group',
  };

  const GLOBE = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>';
  const KIND_ICON = {
    any: GLOBE,
    geoip: GLOBE,
    host: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    network: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5m0 0-6 5m6-5 6 5"/>',
    'interface-network': '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v5m0 0-6 5m6-5 6 5"/>',
    interface: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v6M15 9v6M9 15v6"/>',
    group: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    service: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  };

  function kindIcon(kind) {
    const path = KIND_ICON[kind];
    if (!path) return null;
    return h('span', {
      class: 'kind-icon',
      'aria-hidden': 'true',
      html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>',
    });
  }

  /** Address text of a network object as the Securepoint GUI shows it. */
  function nodeAddress(node) {
    if (node.kind === 'interface' || node.kind === 'interface-network') {
      return (node.cidr || '') + (node.device ? ' (' + node.device + ')' : '');
    }
    return node.address;
  }

  /** Chip for a source/destination name: a node (colored by its zone) or a node group. */
  function endpointChip(resolved) {
    if (resolved.type === 'group') {
      return h('span', { class: 'chip chip-object', style: { '--chip': 'var(--primary)' }, title: resolved.members.map(function (m) { return m.name; }).join(', ') },
        kindIcon('group'), resolved.name, h('span', { class: 'chip-count' }, String(resolved.members.length)));
    }
    if (resolved.type === 'node') {
      const node = resolved.node;
      return h('span', { class: 'chip chip-object', style: { '--chip': zoneColor(node.zone) }, title: KIND_LABEL[node.kind] + ' · ' + nodeAddress(node) },
        kindIcon(node.kind), resolved.name);
    }
    return h('span', { class: 'chip chip-object', title: 'Not found in report' }, resolved.name);
  }

  /** Chip for a service or service group. */
  function serviceChip(resolved) {
    if (resolved.type === 'group') {
      return h('span', { class: 'chip chip-object', style: { '--chip': 'var(--violet)' }, title: resolved.members.map(function (m) { return m.name; }).join(', ') },
        kindIcon('group'), resolved.name, h('span', { class: 'chip-count' }, String(resolved.members.length)));
    }
    if (resolved.type === 'service') {
      const svc = resolved.service;
      return h('span', { class: 'chip chip-object', style: { '--chip': 'var(--violet)' }, title: serviceSummary(svc) },
        kindIcon('service'), resolved.name);
    }
    return h('span', { class: 'chip chip-object', title: 'Not found in report' }, resolved.name);
  }

  /** "tcp 80, 443" style one-liner of a service. */
  function serviceSummary(svc) {
    const detail = svc.ports.length ? svc.ports.join(', ') : (svc.icmpTypes.length ? 'type ' + svc.icmpTypes.join(', ') : '');
    return (svc.protocol || '') + (detail ? ' ' + detail : '');
  }

  RouterLens.spui = {
    KIND_LABEL: KIND_LABEL,
    kindIcon: kindIcon,
    nodeAddress: nodeAddress,
    endpointChip: endpointChip,
    serviceChip: serviceChip,
    serviceSummary: serviceSummary,
    permissionLabel: permissionLabel,
    zoneColor: zoneColor,
    zoneChip: zoneChip,
    zoneChips: zoneChips,
    dash: dash,
    orDash: orDash,
    splitCidr: splitCidr,
  };
})(window);
