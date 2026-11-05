'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, parseConfig, parseList, parsePortList } = require('../js/devices/planet-switch/parser.js');
const insys = require('../js/devices/insys/parser.js');
const wago = require('../js/devices/wago-switch/parser.js');

const ref = (...p) => fs.readFileSync(path.join(__dirname, '..', 'reference', ...p), 'utf8');
const example = ref('planet-switch', 'example_running-config.cfg');
const wagoExample = ref('wago-switch', 'example_config.save');
const insysExample = ref('insys', 'example_config.txt');

const HEAD = 'SYSTEM CONFIG FILE ::= BEGIN\n';

test('expands VLAN and port lists', () => {
  assert.deepEqual(parseList('10-11,20'), [10, 11, 20]);
  assert.equal(parseList('abc'), null);
  assert.deepEqual(parsePortList('gi1-4'), [1, 2, 3, 4]);
  assert.deepEqual(parsePortList('gi1,gi3'), [1, 3]);
});

test('detects PLANET switch configs and nothing else', () => {
  assert.equal(detect(example), true);
  assert.equal(detect(wagoExample), false);
  assert.equal(detect(insysExample), false);
  // The other text parsers must not pick up a PLANET config either.
  assert.equal(wago.detect(example), false);
  assert.equal(insys.parseConfig(example).values.size, 0);
});

test('parses system, management and model', () => {
  const cfg = parseConfig(example);
  assert.equal(cfg.model, 'GS-4210-24PL4C');
  assert.ok(cfg.modelDescription);
  assert.equal(cfg.system.name, 'GS-4210-24PL4C');
  assert.equal(cfg.system.version, 'v3.0.5.48161.48161');
  assert.equal(cfg.system.uptime, '12 days, 3 hours, 56 mins, 16 secs');
  assert.deepEqual(cfg.management, { address: '192.168.10.5', mask: '255.255.255.0', dhcp: false, gateway: '192.168.10.1', dns: ['192.168.10.1', '8.8.8.8'] });
  assert.deepEqual(cfg.warnings, []);
});

test('parses users without keeping the secrets', () => {
  const cfg = parseConfig(example);
  assert.deepEqual(cfg.users, [
    { name: 'admin', privilege: null, credential: 'secret-encrypted' },
    { name: 'service', privilege: null, credential: 'secret-encrypted' },
  ]);
  assert.equal(JSON.stringify(cfg).indexOf('MDAwMDAw'), -1);
});

test('parses VLANs, SNMP, PoE globals, spanning tree and services', () => {
  const cfg = parseConfig(example);
  assert.deepEqual(cfg.vlans.map((v) => [v.id, v.name]), [[1, 'Default'], [10, 'Office'], [11, 'Production'], [20, 'WAN']]);
  // "no snmp community public" followed by "snmp community public ro": the later one wins
  assert.deepEqual(cfg.snmp.communities, [{ name: 'public', access: 'ro', wellKnown: true }]);
  assert.equal(cfg.poe.adminMode, 'enable');
  assert.equal(cfg.poe.limitMode, 'consumption');
  assert.equal(cfg.poe.temperatureThreshold, 120);
  assert.equal(cfg.spanningTree.mstName, 'A8:F7:E0:00:00:01');
  assert.equal(cfg.voiceVlan.oui.length, 8);
  assert.deepEqual(cfg.voiceVlan.oui[0], { oui: '00:E0:BB', description: '3COM' });
  assert.equal(cfg.services.httpSecureRedirect, true);
  assert.deepEqual(cfg.otherGlobals, ['no dos udpblat-deny']);
});

test('derives the effective VLAN setup and PoE per port', () => {
  const ports = parseConfig(example).ports;
  assert.equal(ports.length, 28);
  const port = (n) => ports.find((p) => p.number === n);

  assert.deepEqual(
    { mode: port(1).mode, pvid: port(1).pvid, untagged: port(1).untagged, tagged: port(1).tagged, description: port(1).description },
    { mode: 'access', pvid: 20, untagged: [20], tagged: [], description: 'WAN uplink' });
  assert.equal(port(1).modeConfigured, true);

  // No "switchport mode": default trunk, native VLAN 1 untagged plus the added VLANs tagged
  assert.deepEqual({ mode: port(5).mode, pvid: port(5).pvid, untagged: port(5).untagged, tagged: port(5).tagged }, { mode: 'trunk', pvid: 1, untagged: [1], tagged: [10, 11] });
  assert.equal(port(5).modeConfigured, false);
  assert.deepEqual(port(7).untagged, [1]);
  assert.deepEqual(port(7).tagged, []);

  assert.deepEqual(port(3).poe, { capable: true, enabled: true, priority: 'critical' });
  assert.equal(port(25).media, 'sfp');
  assert.equal(port(25).poe, null);
  assert.equal(port(24).media, '1000');
});

test('handles trunk, hybrid and shutdown statements', () => {
  const cfg = parseConfig(HEAD +
    'vlan 1,5,7\n' +
    'interface gi1\n switchport mode trunk\n switchport trunk native vlan 5\n switchport trunk allowed vlan add 1,5,7\n switchport trunk allowed vlan remove 7\n shutdown\n' +
    'interface gi2\n switchport mode hybrid\n switchport hybrid pvid 7\n switchport hybrid allowed vlan add 7 untagged\n switchport hybrid allowed vlan add 5\n speed 100\n' +
    'interface gi3\n switchport mode access\n switchport access vlan 9\n');
  const [p1, p2, p3] = cfg.ports;
  assert.deepEqual({ pvid: p1.pvid, untagged: p1.untagged, tagged: p1.tagged, shutdown: p1.shutdown }, { pvid: 5, untagged: [5], tagged: [1], shutdown: true });
  assert.deepEqual({ pvid: p2.pvid, untagged: p2.untagged, tagged: p2.tagged, other: p2.other }, { pvid: 7, untagged: [7], tagged: [5], other: ['speed 100'] });
  assert.deepEqual(p3.undefinedVlans, [9]);
  assert.deepEqual(cfg.vlans.map((v) => v.id), [1, 5, 7]);
});
