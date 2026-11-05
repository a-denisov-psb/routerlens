'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseConfig } = require('../js/devices/insys/parser.js');

const example = fs.readFileSync(path.join(__dirname, '..', 'reference', 'insys', 'example_config.txt'), 'utf8');

test('parses simple key=value pairs', () => {
  const cfg = parseConfig('a.b.c=1\na.b.d=hello world\n');
  assert.equal(cfg.get('a.b.c'), '1');
  assert.equal(cfg.node('a.b').d, 'hello world');
});

test('keeps empty values and "=" inside values', () => {
  const cfg = parseConfig('a.empty=\na.eq=x=y==\n');
  assert.equal(cfg.get('a.empty'), '');
  assert.equal(cfg.get('a.eq'), 'x=y==');
});

test('builds 1-based arrays, including nested ones', () => {
  const cfg = parseConfig([
    'n.net[2].name=net2',
    'n.net[1].name=net1',
    'n.net[1].ip[1].addr=10.0.0.1',
    'n.net[1].ip[2].addr=10.0.0.2',
  ].join('\n'));
  const nets = cfg.list('n.net');
  assert.deepEqual(nets.map((n) => n.name), ['net1', 'net2']);
  assert.deepEqual(nets.map((n) => n._index), [1, 2]);
  assert.equal(nets[0].ip[1].addr, '10.0.0.2');
});

test('separates delete/add directives from values', () => {
  const cfg = parseConfig('x.rule.delete=all\nx.rule.add=2\nx.rule[1].a=1\n');
  assert.equal(cfg.directives.length, 2);
  assert.equal(cfg.has('x.rule.add'), false);
  assert.equal(cfg.list('x.rule').length, 1);
});

test('reads multi-line PEM values containing "=" up to the END marker', () => {
  const cfg = parseConfig([
    'c.cert=-----BEGIN CERTIFICATE-----',
    'AAAA',
    'BB==',
    '-----END CERTIFICATE-----',
    'c.next=1',
  ].join('\n'));
  assert.equal(cfg.get('c.cert'), '-----BEGIN CERTIFICATE-----\nAAAA\nBB==\n-----END CERTIFICATE-----');
  assert.equal(cfg.get('c.next'), '1');
  assert.equal(cfg.warnings.length, 0);
});

test('unwraps icom text wrappers named after the key', () => {
  const cfg = parseConfig([
    'a.device_note=-----BEGIN device_note-----',
    'line 1',
    'x = y',
    '-----END device_note-----',
    'a.empty_note=-----BEGIN empty_note----------END empty_note-----',
    'a.inline=-----BEGIN inline-----text-----END inline-----',
  ].join('\n'));
  assert.equal(cfg.get('a.device_note'), 'line 1\nx = y');
  assert.equal(cfg.node('a').device_note, 'line 1\nx = y');
  assert.equal(cfg.get('a.empty_note'), '');
  assert.equal(cfg.get('a.inline'), 'text');
});

test('handles CRLF line endings and BOM', () => {
  const cfg = parseConfig('﻿a.b=1\r\na.c=2\r\n');
  assert.equal(cfg.get('a.b'), '1');
  assert.equal(cfg.get('a.c'), '2');
});

test('warns about unterminated multi-line values', () => {
  const cfg = parseConfig('a.k=-----BEGIN CERTIFICATE-----\nAAAA\n');
  assert.equal(cfg.warnings.length, 1);
});

test('normalizes legacy flat interfaces.netN into interfaces.ip_nets.net', () => {
  const cfg = parseConfig([
    'interfaces.net1.active=1',
    'interfaces.net1.description=LAN',
    'interfaces.net1.ip_address[1].ip_address=192.168.10.1',
    'interfaces.net1.ip_address[1].netmask=24',
    'interfaces.net3.active=1',
    'interfaces.net3.description=WAN',
    'services.dhcp_server.server[1].active=1',
    'services.dhcp_server.server[1].start_ip=192.168.10.250',
    'services.dhcp_server.server[3].active=0',
  ].join('\n'));

  const nets = cfg.list('interfaces.ip_nets.net');
  assert.deepEqual(nets.map((n) => n.name), ['net1', 'net3']);
  assert.equal(nets[0].description, 'LAN');
  assert.equal(nets[0].ip_address[0].ip_address, '192.168.10.1');
  assert.equal(nets[0].color, '#FFDB42');
  assert.equal(nets[1].color, '#FF9EAF');

  const servers = cfg.list('services.dhcp_server.server');
  assert.deepEqual(servers.map((s) => s.interface), ['net1', 'net3']);
});

test('assigns a random color to legacy nets beyond the fixed 5-color palette', () => {
  const cfg = parseConfig('interfaces.net6.description=extra\n');
  const color = cfg.list('interfaces.ip_nets.net')[0].color;
  assert.match(color, /^#[0-9A-F]{6}$/);
});

test('leaves interfaces.ip_nets.net untouched when already present', () => {
  const cfg = parseConfig([
    'interfaces.ip_nets.net[1].name=net1',
    'interfaces.net9.description=should be ignored',
  ].join('\n'));
  assert.deepEqual(cfg.list('interfaces.ip_nets.net').map((n) => n.name), ['net1']);
});

test('parses the reference example config', () => {
  const cfg = parseConfig(example);
  assert.equal(cfg.warnings.length, 0, JSON.stringify(cfg.warnings));
  assert.equal(cfg.get('administration.hostnames.hostname'), 'example-router');
  assert.equal(cfg.get('administration.hostnames.device_note'), '');
  assert.equal(cfg.get('interfaces.ethernet1.port1_active'), 'net1');
  assert.equal(cfg.list('interfaces.ip_nets.net').length, 2);
  assert.equal(cfg.list('netfilter.ip_filter.rule').length, 29);
  assert.equal(cfg.get('netfilter.ip_filter.rule[1].rule_dport'), '80');

  const bird = cfg.get('routing.bird.config');
  assert.match(bird, /^router id 192\.168\.1\.1;/);
  assert.match(bird, /export all;\n}$/);

  const ca = cfg.get('administration.certificates.ca_certs.ca[1].ca_certificate');
  assert.match(ca, /^-----BEGIN CERTIFICATE-----\n/);
  assert.match(ca, /\n-----END CERTIFICATE-----$/);
  assert.equal(cfg.get('administration.certificates.ca_certs.ca[1].description').startsWith('COMODO'), true);
});
