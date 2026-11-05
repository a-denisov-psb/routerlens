'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, parseConfig, parsePortList } = require('../js/devices/wago-switch/parser.js');
const insys = require('../js/devices/insys/parser.js');

const example = fs.readFileSync(path.join(__dirname, '..', 'reference', 'wago-switch', 'example_config.save'), 'utf8');
const insysExample = fs.readFileSync(path.join(__dirname, '..', 'reference', 'insys', 'example_config.txt'), 'utf8');

test('expands port lists', () => {
  assert.deepEqual(parsePortList('1-8,10'), [1, 2, 3, 4, 5, 6, 7, 8, 10]);
  assert.deepEqual(parsePortList('9, 4'), [4, 9]);
  assert.equal(parsePortList('1/0/1'), null);
});

test('detects WAGO switch configs and nothing else', () => {
  assert.equal(detect(example), true);
  assert.equal(detect(insysExample), false);
  // The INSYS parser must not pick up a WAGO config either.
  assert.equal(insys.parseConfig(example).values.size, 0);
});

test('parses VLANs with members and tagged ports', () => {
  const cfg = parseConfig(example);
  assert.equal(cfg.vlans.length, 2);
  const [v1, v3] = cfg.vlans;
  assert.deepEqual({ id: v1.id, name: v1.name, fixed: v1.fixed, tagged: v1.tagged }, { id: 1, name: 'VLAN1', fixed: [1, 2, 3, 4, 5, 6, 7, 8, 10], tagged: [] });
  assert.deepEqual({ id: v3.id, name: v3.name, fixed: v3.fixed, tagged: v3.tagged }, { id: 3, name: 'Site B', fixed: [4, 9], tagged: [4] });
});

test('derives the effective VLAN setup per port', () => {
  const ports = parseConfig(example).ports;
  assert.equal(ports.length, 10);

  const p4 = ports.find((p) => p.number === 4);
  assert.deepEqual(p4.untagged, [1]);
  assert.deepEqual(p4.tagged, [3]);
  assert.equal(p4.pvid, 1);
  assert.equal(p4.pvidMember, true);
  assert.equal(p4.media, '100');
  assert.equal(p4.ring, null);
  assert.deepEqual(ports.find((p) => p.number === 1).ring, { id: 1, enabled: false });

  const p9 = ports.find((p) => p.number === 9);
  assert.deepEqual(p9.untagged, [3]);
  assert.deepEqual(p9.tagged, []);
  assert.equal(p9.pvid, 3);
  assert.equal(p9.acceptableFrames, 'untagged');
  assert.equal(p9.media, 'sfp'); // 852-603: ports 9 and 10 are SFP slots
  assert.equal(p9.ring, null);
});

test('parses management interface, MRP ring and global settings', () => {
  const cfg = parseConfig(example);
  assert.equal(cfg.model, '852-0603');
  assert.ok(cfg.modelDescription);
  assert.deepEqual(cfg.features, { profinet: true, lldp: true });
  assert.equal(cfg.management.length, 1);
  assert.deepEqual(cfg.management[0].settings, { address: '192.168.10.2/24', gateway: '192.168.10.1' });
  assert.deepEqual(cfg.rings, [{ id: 1, enabled: false, uuid: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', ports: [1, 2], vlan: 1, role: null, other: [] }]);
  assert.deepEqual(cfg.warnings, []);
});

test('keeps unknown statements instead of dropping them', () => {
  const cfg = parseConfig('vlan 5\nname X\nfixed 1\nigmp snooping\n!\ninterface fastethernet1/0/1\nspeed 100\n!\nhostname sw1\nno lldp enable\n');
  assert.deepEqual(cfg.vlans[0].other, ['igmp snooping']);
  assert.deepEqual(cfg.interfaces[0].other, ['speed 100']);
  assert.deepEqual(cfg.otherGlobals, ['hostname sw1']);
  assert.deepEqual(cfg.features, { lldp: false });
});

test('flags a PVID that is not an untagged member VLAN of the port', () => {
  const cfg = parseConfig('vlan 1\nfixed 1\n!\nvlan 2\nfixed 1\ntagged 1\n!\ninterface fastethernet1/0/1\npvid 2\n!\n');
  assert.equal(cfg.ports[0].pvidMember, false);
});
