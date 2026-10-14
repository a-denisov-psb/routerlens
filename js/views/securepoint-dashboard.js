/*
 * Securepoint dashboard: system info, firewall figures, users with their groups, one card
 * per network interface (addresses, zones, link settings) and the routing table.
 * Only configuration state is shown; load, uptime, connection counts and the like that
 * the report also contains are left out.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const spui = RouterLens.spui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
    '<rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

  function render(report) {
    return h('div', { class: 'dashboard' },
      h('div', { class: 'grid' },
        systemCard(report),
        firewallCard(report),
        usersCard(report),
        routesCard(report)),
      interfacesSection(report));
  }

  /* ---------- System ---------- */

  function applicationValue(report, variable) {
    const entry = report.applications.filter(function (a) { return a.variable === variable && a.value; })[0];
    return entry ? entry.value : undefined;
  }

  function lines(value) {
    return value ? value.split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
  }

  function systemCard(report) {
    const s = report.system;
    const nameservers = lines(report.globals.GLOB_NAMESERVER);
    const ntp = lines(applicationValue(report, 'NTP_SERVER_LIST'));
    const body = ui.kvList([
      ['Hostname', s.hostname],
      ['Model', s.productname],
      ['Device type', s.devicetype],
      ['UTM version', s.version],
      ['Licensee', s.organizationName],
      ['License', s.daysleft ? s.daysleft + ' days left' : undefined],
      ['Serial number', s.serialnumber],
      ['Name server', nameservers.length ? nameservers.join(', ') : undefined],
      ['NTP server', ntp.length ? ntp.join(', ') : undefined],
      ['Report created', report.generated],
    ]);
    return ui.card({ title: 'System', className: 'card-system', body: body || ui.emptyNote('No system information in this report.') });
  }

  /* ---------- Firewall figures ---------- */

  function firewallCard(report) {
    const rules = report.rules;
    const active = rules.filter(function (r) { return r.enabled; }).length;
    const groups = report.ruleGroups;
    const activeGroups = groups.filter(function (g) { return g.enabled; }).length;
    const nat = rules.filter(function (r) { return r.natType; }).length;
    const geoip = report.nodes.filter(function (n) { return n.kind === 'geoip'; }).length;
    const objects = report.nodes.length - geoip;

    const body = ui.kvList([
      ['Rule groups', groups.length ? activeGroups + ' active / ' + groups.length : undefined],
      ['Rules', rules.length ? active + ' active / ' + rules.length : undefined],
      ['Rules with NAT', rules.length ? String(nat) : undefined],
      ['Network objects', report.nodes.length ? objects + (geoip ? ' (+ ' + geoip + ' GeoIP)' : '') : undefined],
      ['Object groups', report.nodeGroups.length ? String(report.nodeGroups.length) : undefined],
      ['Services', report.services.length ? String(report.services.length) : undefined],
      ['Service groups', report.serviceGroups.length ? String(report.serviceGroups.length) : undefined],
    ]);
    return ui.card({ title: 'Firewall', body: body || ui.emptyNote('No firewall data in this report.') });
  }

  /* ---------- Users ---------- */

  function usersCard(report) {
    if (!report.users.length) return ui.card({ title: 'Users', body: ui.emptyNote('No users configured.') });
    const rows = report.users.map(function (u) {
      return h('tr', null,
        h('td', null, spui.orDash(u.name)),
        h('td', null, u.groups.length ? u.groups.map(function (g) { return h('span', { class: 'pill pill-info' }, g); }) : spui.dash()),
        h('td', { class: 'muted' }, spui.permissionLabel(u.permission) || ui.EMPTY));
    });
    const table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'User'), h('th', null, 'Groups'), h('th', null, 'Permission'))),
      h('tbody', null, rows));
    return ui.card({ title: 'Users', className: 'card-users', body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- Routing ---------- */

  function isDefaultRoute(route) {
    return route.destination === '0.0.0.0/0';
  }

  function routesCard(report) {
    if (!report.routes.length) return ui.card({ title: 'Routes', body: ui.emptyNote('No static routes configured.') });
    const rows = report.routes.map(function (r) {
      return h('tr', null,
        h('td', null,
          h('code', null, r.destination || ui.EMPTY),
          isDefaultRoute(r) ? [' ', h('span', { class: 'badge badge-route-default' }, 'Default')] : null),
        h('td', null, r.gateway ? h('code', null, r.gateway) : spui.dash()),
        h('td', null, spui.orDash(r.viaDevice || r.device)),
        h('td', { class: 'muted' }, r.weight === null ? ui.EMPTY : String(r.weight)));
    });
    const table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Destination'), h('th', null, 'Gateway'), h('th', null, 'Interface'), h('th', null, 'Weight'))),
      h('tbody', null, rows));
    return ui.card({ title: 'Routes', className: 'card-routes', body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- Interfaces ---------- */

  function interfaceRoles(report, iface) {
    const roles = [];
    const isWan = report.routes.some(function (r) { return isDefaultRoute(r) && (r.viaDevice || r.device) === iface.name; });
    if (isWan) roles.push('WAN');
    if (iface.type === 'TUN') roles.push('VPN');
    if (iface.type === 'WLAN') roles.push('WLAN');
    return roles;
  }

  function linkText(props) {
    if (!props.speed && !props.autonegotiation) return undefined;
    const parts = [];
    if (props.speed) parts.push(props.speed + ' Mbit/s');
    if (props.duplex) parts.push(props.duplex + ' duplex');
    if (props.autonegotiation === 'on') parts.push('(auto-negotiation)');
    return parts.join(' ');
  }

  function dynDns(props) {
    return props.dyndns_server ? props.dyndns_server : undefined;
  }

  function interfaceCard(report, iface) {
    const props = iface.props;
    const roles = interfaceRoles(report, iface);
    const subtitle = iface.type === 'VLAN' && props.vlan_id
      ? 'VLAN ' + props.vlan_id + (props.vlan_parent ? ' on ' + props.vlan_parent : '')
      : iface.type;

    const addresses = iface.addresses.length
      ? h('ul', { class: 'addr-list' }, iface.addresses.map(function (a) {
        const cidr = spui.splitCidr(a.address);
        const dynamic = a.flags.indexOf('DYNAMIC') !== -1;
        return h('li', { class: 'addr' },
          h('code', { class: 'addr-ip' }, a.address),
          cidr.bits !== null ? h('span', { class: 'addr-mask' }, ui.formatNetmask(String(cidr.bits)).replace(/^\/\d+ /, '')) : null,
          dynamic ? h('span', { class: 'pill pill-info' }, 'Dynamic') : null);
      }))
      : ui.emptyNote('No IPv4 address configured.');

    return ui.card({
      title: iface.name,
      subtitle: subtitle,
      aside: roles.length ? roles.map(function (r) { return h('span', { class: 'pill pill-info' }, r); }) : null,
      body: [
        addresses,
        ui.kvList([
          ['Zones', iface.zones.length ? spui.zoneChips(iface.zones) : undefined],
          ['MAC', props.mac],
          ['MTU', props.mtu],
          ['Link', linkText(props)],
          ['Dynamic DNS', dynDns(props)],
        ]),
      ],
    });
  }

  function interfacesSection(report) {
    const cards = report.interfaces.map(function (iface) { return interfaceCard(report, iface); });
    return ui.section('Interfaces', cards.length,
      cards.length ? h('div', { class: 'grid' }, cards) : ui.emptyNote('No interfaces in this report.'));
  }

  RouterLens.views.register({ id: 'dashboard', label: 'Dashboard', icon: ICON, device: 'securepoint', render: render });
})(window);
