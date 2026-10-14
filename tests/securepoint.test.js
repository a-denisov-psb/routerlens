'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, parseReport, networkOf } = require('../js/securepoint/parser.js');
const { itemsToLines } = require('../js/securepoint/pdf-extract.js');

// Pages of reference/securepoint_example_report.pdf (anonymized sample), as extracted by
// pdf-extract.js: pages -> lines -> [x, text] cells.
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'securepoint-pages.json'), 'utf8'))
  .map((lines) => lines.map((cells) => cells.map(([x, text]) => ({ x, end: x, text }))));
const report = parseReport(pages);

test('detects a Securepoint UTM report and reads version and date', () => {
  assert.deepEqual(detect(pages), { version: '14.1.8', generated: '12. Oct 2026, 08:38' });
});

test('rejects documents that are not a Securepoint report', () => {
  const cell = (text) => [{ x: 10, end: 10, text }];
  assert.equal(detect([]), null);
  assert.equal(detect([[cell('Some other PDF')], [], []]), null);
  // Right title but no table of contents with a "System info" entry.
  assert.equal(detect([[cell('Securepoint UTMv14.1.8 Report')], [cell('Table of contents')], []]), null);
  assert.throws(() => parseReport([[cell('Some other PDF')], [], []]), /Not a Securepoint UTM report/);
});

test('groups pdf.js items into lines and orders cells by x', () => {
  const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 3, height: 6 });
  const lines = itemsToLines([item('b', 80, 700), item('a', 60, 700.5), item('c', 60, 690), item('  ', 70, 700), item('d', 60, 100)]);
  assert.deepEqual(lines.map((l) => l.map((c) => c.text)), [['a', 'b'], ['c'], ['d']]);
});

test('reads system info, users and groups', () => {
  assert.equal(report.system.hostname, 'DEMO-RT01.local');
  assert.equal(report.system.productname, 'BLACKDWARFPRO-G5');
  assert.equal(report.users.length, 7);
  assert.deepEqual(report.users[0], { name: 'admin', id: 623, groups: ['administrator'], permission: 'ADMIN' });
  assert.deepEqual(report.userGroups.map((g) => g.name), ['administrator', 'sslvpn']);
});

test('reads interfaces with their addresses, zones and properties', () => {
  const a0 = report.interfaceByName('A0');
  assert.equal(a0.type, 'ETHERNET');
  assert.equal(a0.state, 'UP');
  assert.deepEqual(a0.zones, ['external', 'firewall-external', 'vpn-ipsec', 'firewall-vpn-ipsec', 'vpn-ppp']);
  assert.equal(a0.addresses.length, 1);
  assert.match(a0.addresses[0].address, /\/24$/);
  assert.equal(a0.props.speed, '1000');
  const vlan = report.interfaceByName('A3.20');
  assert.equal(vlan.type, 'VLAN');
  assert.equal(vlan.props.vlan_id, '20');
  assert.equal(vlan.props.vlan_parent, 'A3');
  assert.equal(report.interfaceByName('tun0').type, 'TUN');
});

test('reads routes and zones', () => {
  assert.equal(report.routes.length, 1);
  assert.equal(report.routes[0].destination, '0.0.0.0/0');
  assert.equal(report.routes[0].viaDevice, 'A0');
  assert.equal(report.zones.length, 23);
  assert.deepEqual(report.zones.find((z) => z.name === 'firewall-vpn-ipsec').flags, ['INTERFACE', 'POLICY_IPSEC']);
});

test('classifies network objects', () => {
  const node = (name) => report.nodes.find((n) => n.name === name);
  assert.equal(report.nodes.length, 302);
  assert.equal(node('internet').kind, 'any');
  assert.equal(node('GEOIP:AD').kind, 'geoip');
  assert.equal(node('internal-interface').kind, 'interface');
  assert.equal(node('internal-network').kind, 'interface-network');
  assert.match(node('internal-network').cidr, /\.0\/24$/);
  assert.equal(node('RealVNC-Cloud-01').kind, 'network');
  assert.equal(node('DEMO-NAS01').kind, 'host');
});

test('resolves node groups to their member objects', () => {
  const group = report.resolveEndpoint('remote-access-clients');
  assert.equal(group.type, 'group');
  assert.deepEqual(group.members.map((m) => m.name), ['DEMO-SVR01-PCS', 'SITEA-PC01']);
  assert.equal(report.resolveEndpoint('internet').type, 'node');
  assert.equal(report.resolveEndpoint('does-not-exist').type, 'unknown');
});

test('reads services and resolves service groups', () => {
  assert.equal(report.services.length, 148);
  const netbios = report.services.find((s) => s.name === 'netbios-udp');
  assert.equal(netbios.protocol, 'udp');
  assert.deepEqual(netbios.ports, ['137:138']);
  assert.equal(report.services.find((s) => s.name === 'icmp-echo-req').icmpTypes.length, 1);

  const group = report.resolveService('Teamviewer');
  assert.equal(group.type, 'group');
  assert.deepEqual(group.members.map((m) => m.name), ['teamviewer_tcp', 'teamviewer_udp']);
  assert.equal(report.resolveService('https').type, 'service');
});

test('groups firewall rules and keeps the per-group order', () => {
  assert.deepEqual(
    report.ruleGroups.map((g) => [g.name, g.rules.length, g.count]),
    [['sslvpn-acme-network', 8, 8], ['Wartung', 4, 4], ['internal-network', 7, 7], ['AD-Anbindung', 4, 4], ['wlan-0-network', 2, 2], ['DSL', 5, 5]],
  );
  assert.equal(report.rules.length, 30);
  report.ruleGroups.forEach((g) => assert.deepEqual(g.rules.map((r) => r.pos), g.rules.map((_, i) => i + 1)));
});

test('reads rule fields, NAT and logging', () => {
  const rule = report.rules.find((r) => r.id === 42);
  assert.equal(rule.group, 'internal-network');
  assert.equal(rule.source, 'remote-access-clients');
  assert.equal(rule.destination, 'RealVNC-TCP443-DST');
  assert.equal(rule.service, 'RealVNC-TCP-443');
  assert.equal(rule.action, 'ACCEPT');
  assert.equal(rule.natType, 'HIDENAT');
  assert.equal(rule.natNode, 'external-interface');
  assert.equal(rule.log, 'LOG_ALL');
  assert.equal(rule.enabled, true);

  const plain = report.rules.find((r) => r.id === 12);
  assert.equal(plain.natType, '');
  assert.equal(plain.log, '');
});

test('marks rules of a disabled group as not effective', () => {
  const wartung = report.ruleGroups.find((g) => g.name === 'Wartung');
  assert.equal(wartung.enabled, false);
  assert.ok(wartung.rules.every((r) => r.disabled && !r.enabled));
  assert.deepEqual(report.rules.filter((r) => !r.enabled).map((r) => r.group), ['Wartung', 'Wartung', 'Wartung', 'Wartung']);
});

test('detects auto-generated rule groups and keeps their comments', () => {
  const group = report.ruleGroups.find((g) => g.name === 'wlan-0-network');
  assert.equal(group.autoGenerated, true);
  assert.equal(group.rules.length, 2);
  assert.match(group.rules[0].comment, /^Allow full access from wlan-0-network to internet/);
});

test('reads global and application variables', () => {
  assert.ok(Object.keys(report.globals).length > 50);
  assert.ok(report.globals.GLOB_NAMESERVER.length > 0);
  assert.equal(report.globals.GLOB_VERSION, '14.1.8');
  const dhcpd = report.applications.filter((a) => a.application === 'dhcpd').map((a) => a.variable);
  assert.deepEqual(dhcpd, ['AUTHORITATIVE_4', 'AUTHORITATIVE_6', 'DEBUG', 'MAXLEASES']);
});

test('computes the network address of a CIDR', () => {
  assert.equal(networkOf('192.168.33.1/24'), '192.168.33.0/24');
  assert.equal(networkOf('10.230.200.90/28'), '10.230.200.80/28');
  assert.equal(networkOf('not-an-address'), 'not-an-address');
});

test('finds the rules that use an object or service, directly or through a group', () => {
  const ids = (rules) => rules.map((r) => r.id);
  // DEMO-NAS01 is only used through the groups internal-network-update (rule 9) and -dienste (rule 10).
  assert.deepEqual(ids(report.rulesUsingObject('DEMO-NAS01')), [9, 10]);
  assert.deepEqual(report.groupsOfObject('DEMO-NAS01').map((g) => g.name), ['internal-network-update', 'internal-network-dienste']);
  assert.deepEqual(ids(report.rulesUsingObject('internal-network-rdp')), []);
  assert.deepEqual(ids(report.rulesUsingService('administration')), [15]);
  assert.deepEqual(ids(report.rulesUsingService('ssh')), [15]);
  assert.deepEqual(report.groupsOfService('ssh').map((g) => g.name), ['administration']);
  assert.deepEqual(ids(report.rulesUsingService('RealVNC-TCP-443')), [42]);
  // NAT objects count as usage too.
  assert.ok(ids(report.rulesUsingObject('external-interface')).includes(41));
});
