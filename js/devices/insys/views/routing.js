/*
 * Routing: static routes and the OpenVPN server routes (local + pushed to clients), each
 * as its own table with a per-row detail panel for fields not shown as a column.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>' +
    '<path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>';

  const ROUTE_TYPE_LABEL = { default: 'Default route', net: 'Network' };
  const GATEWAY_TYPE_LABEL = { dynamic: 'Dynamic', static: 'Static IP address', interface: 'Interface' };

  function activePill(active) {
    return active === undefined ? h('span', { class: 'muted' }, ui.EMPTY) : ui.statusPill(active);
  }

  function textOrDash(value) {
    return ui.isUnset(value) ? h('span', { class: 'muted' }, ui.EMPTY) : value;
  }

  function ifaceChip(name, netsByName) {
    if (ui.isUnset(name)) return h('span', { class: 'muted' }, ui.EMPTY);
    const net = netsByName[name];
    return h('span', { class: 'chip', style: net && net.color ? { '--chip': net.color } : null, title: net ? net.description : null },
      h('span', { class: 'chip-dot' }), name);
  }

  function routeTypeBadge(type) {
    if (ui.isUnset(type)) return h('span', { class: 'muted' }, ui.EMPTY);
    return h('span', { class: 'badge badge-route-' + type }, ROUTE_TYPE_LABEL[type] || type);
  }

  function gatewayLabel(type) {
    if (ui.isUnset(type)) return h('span', { class: 'muted' }, ui.EMPTY);
    return GATEWAY_TYPE_LABEL[type] || type;
  }

  /* ---------- Expandable row helper (shared by all three tables) ---------- */

  function expandableRow(cells, colspan, detailContent) {
    const detail = h('tr', { class: 'row-detail', hidden: true }, h('td', { colspan: String(colspan) }, detailContent));
    const tr = h('tr', { class: 'route-row', tabindex: '0', role: 'button', 'aria-expanded': 'false' }, cells);

    function toggle() {
      const willOpen = detail.hidden;
      detail.hidden = !willOpen;
      tr.classList.toggle('open', willOpen);
      tr.setAttribute('aria-expanded', String(willOpen));
    }
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle();
    });

    return [tr, detail];
  }

  /* ---------- Static routes ---------- */

  function staticRouteDetail(route, netsByName) {
    const left = ui.kvList([
      ['Active', route.active === undefined ? undefined : activePill(route.active)],
      ['Interface', route.interface === undefined ? undefined : ifaceChip(route.interface, netsByName)],
      ['Route type', route.route_type === undefined ? undefined : routeTypeBadge(route.route_type)],
      ['Gateway', route.gateway_type === undefined ? undefined : gatewayLabel(route.gateway_type)],
      ['Description', route.description],
    ]);
    const right = ui.kvList([
      ['Address', ui.formatCidr(route.address, route.netmask)],
      ['Static gateway', route.static_gateway],
      ['Interface gateway', route.interface_gateway === undefined ? undefined : ifaceChip(route.interface_gateway, netsByName)],
      ['Priority', route.priority],
      ['Name', route.name],
    ]);
    if (!left && !right) return ui.emptyNote('No further settings for this route.');
    return h('div', { class: 'detail-grid' }, left, right);
  }

  function staticRoutesCard(config, netsByName) {
    const routes = config.list('routing.static_routes.route');
    if (!routes.length) {
      return ui.card({ title: 'Static routes', body: ui.emptyNote('No static routes configured.') });
    }

    const rows = routes.map(function (route) {
      return expandableRow([
        h('td', null, activePill(route.active)),
        h('td', null, ifaceChip(route.interface, netsByName)),
        h('td', null, routeTypeBadge(route.route_type)),
        h('td', null, gatewayLabel(route.gateway_type)),
        h('td', null, textOrDash(route.description)),
      ], 5, staticRouteDetail(route, netsByName));
    });

    const table = h('table', { class: 'table table-expand' },
      h('thead', null, h('tr', null,
        h('th', null, 'Active'), h('th', null, 'Interface'), h('th', null, 'Route type'),
        h('th', null, 'Gateway'), h('th', null, 'Description'))),
      h('tbody', null, rows));

    return ui.card({ title: 'Static routes', body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- OpenVPN server routes (shared local/push table builder) ---------- */

  function ovpnRouteDetail(route) {
    const kv = ui.kvList([['Name', route.name]]);
    return kv || ui.emptyNote('No further settings for this route.');
  }

  function ovpnRoutesCard(config, netsByName, path, title, subtitle, showVpnIp) {
    const routes = config.list(path);
    if (!routes.length) {
      return ui.card({ title: title, subtitle: subtitle, body: ui.emptyNote('No routes configured.') });
    }

    const headers = [h('th', null, 'Active'), h('th', null, 'Interface'), h('th', null, 'Host / network'), h('th', null, 'Common name')];
    if (showVpnIp) headers.push(h('th', null, 'VPN IP'));
    headers.push(h('th', null, 'Description'));
    const colspan = headers.length;

    const rows = routes.map(function (route) {
      const hostNet = ui.formatCidr(route.address, route.netmask);
      const cells = [
        h('td', null, activePill(route.active)),
        h('td', null, ifaceChip(route.interface, netsByName)),
        h('td', null, textOrDash(hostNet)),
        h('td', null, textOrDash(route.common_name)),
      ];
      if (showVpnIp) cells.push(h('td', null, textOrDash(route.vpn_ip)));
      cells.push(h('td', null, textOrDash(route.description)));
      return expandableRow(cells, colspan, ovpnRouteDetail(route));
    });

    const table = h('table', { class: 'table table-expand' },
      h('thead', null, h('tr', null, headers)),
      h('tbody', null, rows));

    return ui.card({ title: title, subtitle: subtitle, body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- View ---------- */

  function render(config) {
    const netsByName = {};
    config.list('interfaces.ip_nets.net').forEach(function (n) { netsByName[n.name] = n; });

    return h('div', { class: 'routing' },
      staticRoutesCard(config, netsByName),
      ovpnRoutesCard(config, netsByName, 'routing.openvpn_routes.ovpn_routes_local.local_route',
        'OpenVPN server routes (local)', 'Routes to networks behind the OpenVPN clients', true),
      ovpnRoutesCard(config, netsByName, 'routing.openvpn_routes.ovpn_routes_push.push_route',
        'OpenVPN server routes (push)', 'Routes advertised to the OpenVPN clients', false));
  }

  RouterLens.views.register({ id: 'routing', label: 'Routing', icon: ICON, device: 'insys', render: render });
})(window);
