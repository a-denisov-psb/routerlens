/*
 * Dashboard: system info, port assignment, firewall status and one card per
 * configured LAN / WAN / VPN interface. Only configuration state is shown –
 * runtime values (uptime, serial number, online state) are not part of the export.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>' +
    '<rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>';

  // Fields that hold secrets or are pure noise; never rendered in generic tunnel cards.
  const HIDDEN_FIELD = /pass|psk|secret|key|pin$|^pin|token|list_uid|^_index$/i;

  // Tunnel list containers below "interfaces" (config key: interfaces.<type>.tunnel[n]).
  const TUNNEL_TYPES = [
    { type: 'ipsec', label: 'IPsec', render: ipsecBody, detail: ipsecFullBody },
    { type: 'openvpn', label: 'OpenVPN', render: openvpnBody, detail: openvpnFullBody },
    { type: 'gre', label: 'GRE', render: genericBody },
    { type: 'dmvpn', label: 'DMVPN', render: genericBody },
    { type: 'pptp', label: 'PPTP', render: genericBody },
    { type: 'pppoe', label: 'PPPoE', render: genericBody },
  ];

  function render(config) {
    const nets = config.list('interfaces.ip_nets.net');
    const netsByName = {};
    nets.forEach(function (n) { netsByName[n.name] = n; });
    const ports = collectPorts(config);

    return h('div', { class: 'dashboard' },
      h('div', { class: 'grid' },
        systemCard(config),
        firewallCard(config),
        usersCard(config),
        portsCard(ports, netsByName)),
      lanSection(config, nets, ports),
      wanSection(config, netsByName),
      vpnSection(config));
  }

  /* ---------- System ---------- */

  function systemCard(config) {
    const hn = config.node('administration.hostnames') || {};
    const time = config.node('administration.time') || {};
    const note = hn.device_note;
    const body = ui.kvList([
      ['Hostname', hn.hostname],
      ['Domain', hn.domainname],
      ['Location', hn.location],
      ['Time zone', time.timezone],
      ['NTP server', time.ntp_peer === undefined ? undefined : [time.ntp_peer, time.ntp_peer2].filter(Boolean).join(', ')],
    ]);
    return ui.card({
      title: 'System',
      className: 'card-system',
      body: [
        body || ui.emptyNote('No system settings in this config.'),
        note !== undefined
          ? h('div', { class: 'note' },
            h('div', { class: 'note-label' }, 'Device note'),
            note ? h('pre', { class: 'note-text' }, note) : h('p', { class: 'muted' }, ui.EMPTY))
          : null,
      ],
    });
  }

  /* ---------- Users ---------- */

  const USER_GROUP_LABEL = { readwrite: 'Read/write', read: 'Read only', status: 'Status only' };

  function userGroupBadge(group) {
    if (ui.isUnset(group)) return h('span', { class: 'muted' }, ui.EMPTY);
    return h('span', { class: 'pill pill-group-' + group }, USER_GROUP_LABEL[group] || group);
  }

  function usersCard(config) {
    const users = config.list('administration.users.user');
    if (!users.length) return ui.card({ title: 'Users', body: ui.emptyNote('No users configured.') });

    const rows = users.map(function (u) {
      return h('tr', null,
        h('td', null, ui.isUnset(u.username) ? h('span', { class: 'muted' }, ui.EMPTY) : u.username),
        h('td', null, userGroupBadge(u.group)),
        h('td', null, u.active === undefined ? h('span', { class: 'muted' }, ui.EMPTY) : ui.statusPill(u.active)));
    });

    const table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Username'), h('th', null, 'Permissions'), h('th', null, 'Active'))),
      h('tbody', null, rows));
    return ui.card({ title: 'Users', className: 'card-users', body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- Firewall status ---------- */

  function firewallCard(config) {
    const ip = config.node('netfilter.ip_filter') || {};
    const mac = config.node('netfilter.mac_filter') || {};
    const rules = config.list('netfilter.ip_filter.rule');
    const activeRules = rules.filter(function (r) { return ui.isOn(r.rule_active); }).length;
    const macRules = config.list('netfilter.mac_filter.rule');

    const body = ui.kvList([
      ['IPv4 filter', ui.flag(ip.active_v4)],
      ['IPv6 filter', ui.flag(ip.active_v6)],
      ['MAC filter', ui.flag(mac.active)],
      ['IP rules', rules.length ? activeRules + ' active / ' + rules.length : undefined],
      ['MAC rules', macRules.length ? String(macRules.length) : undefined],
    ]);
    return ui.card({ title: 'Firewall', body: body || ui.emptyNote('No firewall settings in this config.') });
  }

  /* ---------- Ports ---------- */

  function collectPorts(config) {
    const ports = [];
    const ifaces = config.node('interfaces') || {};
    Object.keys(ifaces).forEach(function (ifName) {
      if (!/^ethernet\d+$/.test(ifName)) return;
      const eth = ifaces[ifName];
      Object.keys(eth).forEach(function (key) {
        const m = /^port(\d+)_active$/.exec(key);
        if (!m) return;
        const p = 'port' + m[1] + '_';
        ports.push({
          iface: ifName,
          number: Number(m[1]),
          net: eth[key],
          multiNets: eth[p + 'multi_nets'],
          autoneg: eth[p + 'autoneg'],
          speed: eth[p + 'speed'],
          duplex: eth[p + 'duplex'],
        });
      });
    });
    ports.sort(function (a, b) { return a.iface.localeCompare(b.iface) || a.number - b.number; });
    return ports;
  }

  function netChip(name, netsByName) {
    if (ui.isUnset(name)) return h('span', { class: 'muted' }, ui.EMPTY);
    const net = netsByName[name];
    return h('span', { class: 'chip', style: net && net.color ? { '--chip': net.color } : null, title: net ? net.description : null },
      h('span', { class: 'chip-dot' }), name);
  }

  function linkMode(port) {
    if (port.autoneg === undefined) return undefined;
    if (ui.isOn(port.autoneg)) return 'Auto';
    return [port.speed ? port.speed + ' Mbit/s' : null, port.duplex || null].filter(Boolean).join(' ') || 'Manual';
  }

  function portsCard(ports, netsByName) {
    if (!ports.length) return ui.card({ title: 'Ports', body: ui.emptyNote('No Ethernet ports in this config.') });
    const multiIface = new Set(ports.map(function (p) { return p.iface; })).size > 1;
    const hasMulti = ports.some(function (p) { return !ui.isUnset(p.multiNets); });

    const rows = ports.map(function (p) {
      const net = netsByName[p.net];
      return h('tr', null,
        h('td', { class: 'port-cell' }, h('span', { class: 'port-badge' }, (multiIface ? p.iface.replace('ethernet', 'E') + '.' : '') + 'P' + p.number)),
        h('td', null, netChip(p.net, netsByName)),
        h('td', { class: net && net.description ? null : 'muted' }, net && net.description ? net.description : ui.EMPTY),
        hasMulti ? h('td', null, ui.isUnset(p.multiNets) ? h('span', { class: 'muted' }, ui.EMPTY)
          : p.multiNets.split(',').map(function (n) { return netChip(n.trim(), netsByName); })) : null,
        h('td', { class: 'muted' }, linkMode(p) || ui.EMPTY));
    });

    const table = h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, 'Port'), h('th', null, 'Network'), h('th', null, 'Description'),
        hasMulti ? h('th', null, 'Additional nets') : null, h('th', null, 'Link'))),
      h('tbody', null, rows));
    return ui.card({ title: 'Ports', className: 'card-ports', body: h('div', { class: 'table-wrap' }, table) });
  }

  /* ---------- LAN / IP networks ---------- */

  function lanSection(config, nets, ports) {
    const dhcpServers = config.list('services.dhcp_server.server');
    // A full export always carries the "services.dhcp_server.server.delete" directive,
    // so "no server for this net" is a configured state, not missing data.
    const dhcpManaged = config.node('services.dhcp_server') !== undefined ||
      config.directives.some(function (d) { return d.key.indexOf('services.dhcp_server.') === 0; });
    const cards = nets.map(function (net) { return netCard(net, ports, dhcpServers, dhcpManaged); });
    return ui.section('IP networks', nets.length,
      cards.length ? h('div', { class: 'grid' }, cards) : ui.emptyNote('No IP networks configured.'));
  }

  function netCard(net, ports, dhcpServers, dhcpManaged) {
    const assigned = ports.filter(function (p) {
      return p.net === net.name || (!ui.isUnset(p.multiNets) && p.multiNets.split(',').map(function (s) { return s.trim(); }).indexOf(net.name) !== -1);
    }).map(function (p) { return 'P' + p.number; });

    const addresses = (net.ip_address || []).filter(Boolean);
    const servers = dhcpServers.filter(function (s) { return s.interface === net.name; });

    const addressList = addresses.length
      ? h('ul', { class: 'addr-list' }, addresses.map(function (a) {
        return h('li', { class: 'addr' + (ui.isOn(a.ip_active) || a.ip_active === undefined ? '' : ' addr-off') },
          h('code', { class: 'addr-ip' }, ui.formatCidr(a.ip_address, a.netmask) || ui.EMPTY),
          a.netmask !== undefined && /^\d+$/.test(a.netmask) ? h('span', { class: 'addr-mask' }, ui.formatNetmask(a.netmask).replace(/^\/\d+ /, '')) : null,
          a.ip_description ? h('span', { class: 'addr-desc' }, a.ip_description) : null,
          a.ip_active !== undefined && !ui.isOn(a.ip_active) ? h('span', { class: 'pill pill-off' }, 'Inactive') : null);
      }))
      : null;

    const dhcpServerValue = servers.length
      ? servers.map(function (s) {
        return h('div', { class: 'dhcp-range' + (ui.isOn(s.active) ? '' : ' muted') },
          ui.flag(s.active), ' ', [s.start_ip, s.end_ip].filter(Boolean).join(' – '),
          s.leasetime ? h('span', { class: 'muted' }, ' · lease ' + s.leasetime + ' min') : null);
      })
      : (dhcpManaged ? ui.flag('0') : undefined);

    return ui.card({
      title: net.name,
      subtitle: net.description || null,
      accent: net.color,
      inactive: net.active !== undefined && !ui.isOn(net.active),
      aside: net.active !== undefined ? ui.statusPill(net.active) : null,
      body: [
        addressList || ui.emptyNote('No IPv4 address configured.'),
        ui.kvList([
          ['Mode', net.mode],
          ['DHCP client', ui.flag(net.dhcpv4_active)],
          ['DHCPv6 client', ui.flag(net.dhcpv6_active)],
          ['SLAAC', ui.flag(net.slaac_active)],
          ['DHCP server', dhcpServerValue],
          ['VLAN tag', net.vlan_tag],
          ['MTU', net.mtu],
          ['MAC', net.mac_mode === undefined ? undefined : (net.mac_mode === 'automatic' ? 'automatic' : (net.user_defined_mac || net.mac_mode))],
          ['Ports', ports.length ? (assigned.join(', ') || '') : undefined],
        ]),
      ],
    });
  }

  /* ---------- WAN ---------- */

  /** Maps every addressable interface name to its description, for lookups from the WAN chain. */
  function interfaceLabels(config, netsByName) {
    const labels = {};
    Object.keys(netsByName).forEach(function (name) { labels[name] = netsByName[name].description; });
    TUNNEL_TYPES.forEach(function (t) {
      config.list('interfaces.' + t.type + '.tunnel').forEach(function (tunnel) {
        if (tunnel.name) labels[tunnel.name] = tunnel.description;
      });
    });
    const ifaces = config.node('interfaces') || {};
    Object.keys(ifaces).forEach(function (name) {
      const iface = ifaces[name];
      if (labels[name] === undefined && iface && !Array.isArray(iface) && typeof iface === 'object' && typeof iface.description === 'string') {
        labels[name] = iface.description;
      }
    });
    return labels;
  }

  /** WAN groups bundle several interfaces under one name; a chain position can target the group instead of a single interface. */
  function wanGroupMap(config) {
    const map = {};
    config.list('wan.wan_groups.wan_group').forEach(function (g) {
      map[g.name] = {
        name: g.name,
        description: g.description,
        members: (g.interfaces || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      };
    });
    return map;
  }

  /** What happens when this position's interface (or group) goes offline. */
  function chainFailureText(step, chain, isGroup) {
    if (isGroup) return 'Restart interface(s) only (WAN group)';
    if (ui.isUnset(step.check_fail_wan)) return undefined;
    return step.check_fail_wan === chain.name
      ? 'Restart this WAN chain'
      : 'Start WAN chain "' + step.check_fail_wan + '"';
  }

  /** Optional active connection check (DNS/ping/link) layered on top of the interface's own link state. */
  function chainCheckDetail(step) {
    if (ui.isUnset(step.check_type) || step.check_type === 'none') return null;
    const target = step.check_type === 'dns' ? step.dns_target
      : step.check_type === 'ping' ? step.ping_target
        : step.check_type === 'link' ? step.link_port
          : undefined;
    return ui.kvList([
      ['Check type', step.check_type],
      ['Target', target],
      ['Check interval', ui.isUnset(step.check_interval) ? undefined : step.check_interval + ' s'],
      ['Failures before restart', step.check_failures],
      ['Recheck interval', ui.isUnset(step.recheck_interval) ? undefined : step.recheck_interval + ' s'],
    ]);
  }

  function chainStepCard(step, position, chain, wanGroups, labels) {
    const group = wanGroups[step.interface];
    const isGroup = !!group;
    const members = isGroup ? group.members : [step.interface];
    const hint = chainFailureText(step, chain, isGroup);

    const head = h('div', { class: 'chain-step-head' },
      h('span', { class: 'chain-step-pos' }, String(position)),
      h('div', { class: 'chain-step-main' },
        h('div', { class: 'chain-members' }, members.map(function (m) {
          return h('div', { class: 'chain-member' },
            h('code', null, m),
            labels[m] ? h('span', { class: 'muted' }, labels[m]) : null);
        })),
        isGroup ? h('span', { class: 'pill pill-info' }, 'WAN group' + (group.description ? ' · ' + group.description : '')) : null,
        hint ? h('p', { class: 'chain-step-hint muted' }, 'On failure: ' + hint) : null));

    const detail = chainCheckDetail(step);
    if (!detail) return h('div', { class: 'chain-step chain-step-static' }, head);
    return h('details', { class: 'chain-step' },
      h('summary', null, head),
      h('div', { class: 'chain-step-body' }, detail));
  }

  function wanSection(config, netsByName) {
    const cards = [];
    const wans = config.node('wan.wans') || {};
    const wanGroups = wanGroupMap(config);
    const labels = interfaceLabels(config, netsByName);

    config.list('wan.wans.wan_chain').forEach(function (chain) {
      const steps = (chain.interface || []).filter(Boolean);
      cards.push(ui.card({
        title: chain.name,
        subtitle: chain.description || 'WAN chain',
        inactive: wans.active !== undefined && !ui.isOn(wans.active),
        aside: wans.active !== undefined ? ui.statusPill(wans.active) : null,
        body: [
          ui.kvList([
            ['Lifetime limit', chain.lifetime_active === undefined ? undefined : (ui.isOn(chain.lifetime_active) ? (chain.lifetime || '') + ' → ' + (chain.lifetime_wan || '') : 'Off')],
          ]),
          steps.length
            ? h('div', { class: 'chain-steps' }, steps.map(function (step, i) {
              return chainStepCard(step, i + 1, chain, wanGroups, labels);
            }))
            : ui.emptyNote('No interfaces in this chain.'),
        ],
      }));
    });

    // Mobile interfaces (e.g. interfaces.lte2) are identified by their APN setting.
    const ifaces = config.node('interfaces') || {};
    Object.keys(ifaces).forEach(function (name) {
      const iface = ifaces[name];
      if (!iface || Array.isArray(iface) || typeof iface !== 'object' || iface.apn === undefined) return;
      cards.push(ui.card({
        title: name,
        subtitle: (iface.description || '').trim() || 'Mobile interface',
        body: ui.kvList([
          ['APN', iface.apn],
          ['Authentication', iface.auth],
          ['IP version', iface.ip_version],
          ['Provider selection', iface.provider_mode],
          ['Radio', ['allow_2g', 'allow_3g', 'allow_4g', 'allow_5g']
            .filter(function (k) { return iface[k] !== undefined; })
            .map(function (k) { return ui.isOn(iface[k]) ? k.slice(6).toUpperCase() : null; })
            .filter(Boolean).join(' / ') || undefined],
          ['SIM slots', iface.first_channel === undefined ? undefined : [iface.first_channel, iface.second_channel].filter(function (c) { return c && c !== '0'; }).join(', ')],
          ['APN (2nd SIM)', iface.apn2],
          ['MTU', iface.mtu],
        ]),
      }));
    });

    // DSL interfaces (e.g. interfaces.dsl2) are identified by their line mode.
    Object.keys(ifaces).forEach(function (name) {
      const iface = ifaces[name];
      if (!iface || Array.isArray(iface) || typeof iface !== 'object' || iface.mode === undefined || !/^dsl\d+$/.test(name)) return;
      cards.push(ui.card({
        title: name,
        subtitle: (iface.description || '').trim() || 'DSL interface',
        body: ui.kvList([
          ['Mode', iface.mode],
          ['Username', iface.mode === 'pppoe' || iface.mode === 'pppoa' ? iface.username : undefined],
          ['Bridge network', iface.mode === 'bridge' ? iface.bridge_net : undefined],
          ['DHCP client', iface.mode === 'wan' || iface.mode === 'bridge' ? ui.flag(iface.dhcpv4_active) : undefined],
          ['VPI / VCI', iface.vpi === undefined ? undefined : iface.vpi + ' / ' + iface.vci],
          ['Multiplexing', iface.multiplex],
          ['VLAN tag', iface.vlan_tag],
          ['MTU', iface.mtu],
          ['Connect timer', ui.isUnset(iface.connect_timer) ? undefined : iface.connect_timer + ' s'],
        ]),
      }));
    });

    return ui.section('WAN', cards.length,
      cards.length ? h('div', { class: 'grid' }, cards) : ui.emptyNote('No WAN configured.'));
  }

  /* ---------- VPN ---------- */

  function vpnSection(config) {
    const cards = [];
    TUNNEL_TYPES.forEach(function (t) {
      config.list('interfaces.' + t.type + '.tunnel').forEach(function (tunnel) {
        const title = tunnel.name || t.label + ' ' + tunnel._index;
        cards.push(ui.card({
          title: title,
          subtitle: [t.label, tunnel.description].filter(Boolean).join(' · '),
          inactive: tunnel.active !== undefined && !ui.isOn(tunnel.active),
          aside: tunnel.active !== undefined ? ui.statusPill(tunnel.active) : null,
          body: [
            t.render(tunnel),
            t.detail ? ui.moreLink(function () {
              ui.openModal({ title: title, subtitle: t.label + ' · all settings', body: t.detail(tunnel) });
            }) : null,
          ],
        }));
      });
    });
    return ui.section('VPN', cards.length,
      cards.length ? h('div', { class: 'grid' }, cards) : ui.emptyNote('No VPN tunnels configured.'));
  }

  function ipsecBody(t) {
    return ui.kvList([
      ['Peer', t.peer],
      ['Local IP', t.local_ip === undefined ? undefined : ui.formatCidr(t.local_ip, t.local_ip_nm)],
      ['Local net', t.local_net === undefined ? undefined : ui.formatCidr(t.local_net, t.local_netmask)],
      ['Remote net', t.remote_net === undefined ? undefined : ui.formatCidr(t.remote_net, t.remote_netmask)],
      ['IKE', t.ike_version === undefined ? undefined : [t.ike_version.replace('ike_', 'IKE').replace('_v', 'v'), t.ike_cipher, t.ike_hash, t.ike_dh].filter(Boolean).join(' · ')],
      ['ESP', t.ipsec_cipher === undefined ? undefined : [t.ipsec_cipher, t.ipsec_hash, t.ipsec_dh].filter(Boolean).join(' · ')],
      ['Authentication', t.authentication],
      ['Local ID', t.local_id],
      ['Remote ID', t.remote_id],
      ['Interface', t.tunnel_interface],
    ]);
  }

  /** Everything the curated IPsec card leaves out, for the "More details" modal. */
  function ipsecFullBody(t) {
    return [
      ui.detailGroup('Addressing', [
        ['Peer', t.peer],
        ['Local IP', t.local_ip === undefined ? undefined : ui.formatCidr(t.local_ip, t.local_ip_nm)],
        ['Local net', t.local_net === undefined ? undefined : ui.formatCidr(t.local_net, t.local_netmask)],
        ['Remote net', t.remote_net === undefined ? undefined : ui.formatCidr(t.remote_net, t.remote_netmask)],
        ['Local ID', t.local_id],
        ['Remote ID', t.remote_id],
        ['Local protocol / port', [t.protocol_local, t.port_local].filter(function (v) { return !ui.isUnset(v); }).join(' : ') || undefined],
        ['Remote protocol / port', [t.protocol_remote, t.port_remote].filter(function (v) { return !ui.isUnset(v); }).join(' : ') || undefined],
        ['MTU', t.mtu],
        ['Tunnel interface', t.tunnel_interface],
      ]),
      ui.detailGroup('IKE (phase 1)', [
        ['IKE version', t.ike_version === undefined ? undefined : t.ike_version.replace('ike_', 'IKE').replace('_v', 'v')],
        ['IKEv1 mode', t.ike_v1_mode],
        ['Proposal', t.ike_param],
        ['Cipher', t.ike_cipher],
        ['Hash', t.ike_hash],
        ['DH group', t.ike_dh],
        ['PRF', t.ike_prf],
        ['Rekeying', ui.flag(t.ike_reneg)],
        ['Rekey interval', ui.isUnset(t.ike_reneg_interval) ? undefined : t.ike_reneg_interval + ' s'],
      ]),
      ui.detailGroup('IPsec (phase 2)', [
        ['Proposal', t.ipsec_param],
        ['Cipher', t.ipsec_cipher],
        ['Hash', t.ipsec_hash],
        ['DH group (PFS)', t.ipsec_dh],
        ['Rekey interval', ui.isUnset(t.ipsec_reneg_interval) ? undefined : t.ipsec_reneg_interval + ' s'],
        ['NAT-T encapsulation', ui.flag(t.encap)],
      ]),
      ui.detailGroup('Dead peer detection', [
        ['Interval', ui.isUnset(t.dpd_interval) ? undefined : t.dpd_interval + ' s'],
        ['Timeout', ui.isUnset(t.dpd_timeout) ? undefined : t.dpd_timeout + ' s'],
        ['Action', t.dpd_action],
      ]),
      ui.detailGroup('Authentication', [
        ['Authentication', t.authentication],
        ['CA certificate', t.ca],
        ['Client certificate', t.cert],
        ['Revocation policy', t.revocation_policy],
        ['Connect timer', ui.isUnset(t.connect_timer) ? undefined : t.connect_timer + ' s'],
      ]),
    ].filter(Boolean);
  }

  function openvpnBody(t) {
    return ui.kvList([
      ['Mode', t.mode],
      ['Peer', t.peer === undefined ? undefined : [t.peer, t.peer2].filter(function (p) { return !ui.isUnset(p); }).join(', ')],
      ['Protocol / port', t.protocol === undefined ? undefined : t.protocol + (t.rport ? ' : ' + t.rport : '')],
      ['Local VPN IP', t.local_vpn_ipv4],
      ['Remote VPN IP', t.remote_vpn_ipv4],
      ['Remote net', t.remote_netv4 === undefined ? undefined : ui.formatCidr(t.remote_netv4, t.remote_netmaskv4)],
      ['Address pool', t.pool_ipv4 === undefined ? undefined : ui.formatCidr(t.pool_ipv4, t.pool_netmaskv4)],
      ['Authentication', t.authentication],
      ['Default route', ui.flag(t.defaultroute)],
    ]);
  }

  /** Everything the curated OpenVPN card leaves out, for the "More details" modal. */
  function openvpnFullBody(t) {
    return [
      ui.detailGroup('Connection', [
        ['Mode', t.mode],
        ['Peer', t.peer === undefined ? undefined : [t.peer, t.peer2].filter(function (p) { return !ui.isUnset(p); }).join(', ')],
        ['Protocol', t.protocol],
        ['Local port', t.lport],
        ['Remote port', t.rport],
        ['No bind', ui.flag(t.nobind)],
        ['Float', ui.flag(t.float)],
        ['Default route', ui.flag(t.defaultroute)],
        ['Connect timer', ui.isUnset(t.connect_timer) ? undefined : t.connect_timer + ' s'],
      ]),
      ui.detailGroup('Proxy', [
        ['Proxy server', t.proxy_server],
        ['Proxy type', t.proxy_type],
        ['Proxy port', t.proxy_port],
        ['Proxy username', t.proxy_username],
      ]),
      ui.detailGroup('Tunnel network', [
        ['Local VPN IP', t.local_vpn_ipv4],
        ['Remote VPN IP', t.remote_vpn_ipv4],
        ['Remote net (IPv4)', t.remote_netv4 === undefined ? undefined : ui.formatCidr(t.remote_netv4, t.remote_netmaskv4)],
        ['Local VPN IP (v6)', t.local_vpn_ipv6],
        ['Remote VPN IP (v6)', t.remote_vpn_ipv6],
        ['Remote net (IPv6)', t.remote_netv6 === undefined ? undefined : ui.formatCidr(t.remote_netv6, t.remote_netmaskv6)],
      ]),
      ui.detailGroup('Server settings', [
        ['Address pool (IPv4)', t.pool_ipv4 === undefined ? undefined : ui.formatCidr(t.pool_ipv4, t.pool_netmaskv4)],
        ['Address pool (IPv6)', t.pool_ipv6 === undefined ? undefined : ui.formatCidr(t.pool_ipv6, t.pool_netmaskv6)],
        ['Client-to-client', ui.flag(t.client_to_client)],
        ['Check client certificate', ui.flag(t.check_client_cert)],
      ]),
      ui.detailGroup('Authentication', [
        ['Authentication', t.authentication],
        ['Username', t.username],
        ['CA certificate', t.ca],
        ['Client certificate', t.cert],
        ['TLS auth key', t.tls_auth],
        ['TLS auth direction', t.tls_auth_dir],
        ['TLS crypt key', t.tls_crypt],
        ['Check server certificate', ui.flag(t.check_server_cert)],
        ['Server CRL', t.server_crl],
        ['DH parameter', t.server_dh_parameter],
      ]),
      ui.detailGroup('Encryption', [
        ['Encryption', t.encryption],
        ['Data ciphers', t.data_ciphers],
        ['Data cipher fallback', t.data_ciphers_fallback],
        ['Cipher (legacy)', t.cipher],
        ['Hash / digest', t.hash],
        ['LZO compression', ui.flag(t.comp_lzo)],
      ]),
      ui.detailGroup('Advanced', [
        ['Log level', t.log_level],
        ['Fragment size', t.fragment],
        ['Renegotiation interval', ui.isUnset(t.reneg) ? undefined : t.reneg + ' s'],
        ['Keepalive ping interval', ui.isUnset(t.ping) ? undefined : t.ping + ' s'],
        ['Keepalive restart timeout', ui.isUnset(t.restart) ? undefined : t.restart + ' s'],
        ['mssfix', t.mssfix],
        ['Link MTU', t.link_mtu],
        ['Tun MTU', t.tun_mtu],
      ]),
    ].filter(Boolean);
  }

  function genericBody(t) {
    const rows = Object.keys(t)
      .filter(function (k) { return !HIDDEN_FIELD.test(k) && k !== 'name' && k !== 'description' && k !== 'active'; })
      .filter(function (k) { return typeof t[k] === 'string' && !ui.isUnset(t[k]); })
      .map(function (k) { return [k.replace(/_/g, ' '), t[k]]; });
    return ui.kvList(rows) || ui.emptyNote('No further settings.');
  }

  RouterLens.views.register({ id: 'dashboard', label: 'Dashboard', icon: ICON, device: 'insys', render: render });
})(window);
