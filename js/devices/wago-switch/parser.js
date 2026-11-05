/*
 * WAGO managed switch (852 series) configuration parser.
 *
 * The switch exports its configuration as "config.save": the CLI statements of the running
 * configuration, Cisco style, without indentation. Blocks start with "vlan <id>",
 * "interface <name>" or "mrp ring-id <id>" and end with a line "!". Everything outside a block
 * is a global statement ("lldp enable", "model-name 852-0603", ...).
 *
 *   vlan 3
 *   name Production
 *   fixed 4,9          VLAN members (static egress ports)
 *   tagged 4           members that send this VLAN tagged; the other members send it untagged
 *   !
 *   interface gigabitethernet1/0/9
 *   acceptable frame type untagged
 *   pvid 3
 *   !
 *
 * Statements that are not interpreted are kept (`other`) so the views can still show them.
 * Runs in the browser (global `RouterLens.wagoSwitch`) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const BLOCK_START = /^(vlan|interface|mrp ring-id)\s+(\S+)$/i;
  const PORT_INTERFACE = /^(fastethernet|gigabitethernet|tengigabitethernet|ethernet)(\d+)\/(\d+)\/(\d+)$/i;

  /** Known models: port media by port number, so the views can tell SFP slots from copper ports. */
  const MODELS = {
    '852-603': {
      description: 'Industrial managed switch, 8 × 10/100BASE-TX + 2 × SFP 100BASE-FX / 1000BASE-SX/LX, PROFINET',
      sfpPorts: [9, 10],
    },
  };

  /** "852-0603" and "852-603" denote the same item number. */
  function modelKey(model) {
    const m = /^(\d+)-0*(\d+)(.*)$/.exec(model || '');
    return m ? m[1] + '-' + m[2] + m[3] : model;
  }

  function modelInfo(model) {
    return MODELS[modelKey(model)] || null;
  }

  /** "1-8,10" → [1, 2, 3, 4, 5, 6, 7, 8, 10]; returns null when the list is not numeric. */
  function parsePortList(text) {
    const ports = [];
    const parts = String(text).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (const part of parts) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] !== undefined ? Number(m[2]) : from;
      for (let p = Math.min(from, to); p <= Math.max(from, to); p++) {
        if (ports.indexOf(p) === -1) ports.push(p);
      }
    }
    return ports.sort(function (a, b) { return a - b; });
  }

  /** Splits the file into global statements and blocks, keeping line numbers. */
  function tokenize(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    const globals = [];
    const blocks = [];
    const warnings = [];
    let block = null;

    lines.forEach(function (raw, i) {
      const line = raw.trim();
      if (!line) return;
      if (line === '!') {
        block = null;
        return;
      }
      const statement = { line: i + 1, text: line };
      if (block) {
        block.statements.push(statement);
        return;
      }
      const start = BLOCK_START.exec(line);
      if (start) {
        block = { kind: start[1].toLowerCase(), id: start[2], line: i + 1, statements: [] };
        blocks.push(block);
        return;
      }
      globals.push(statement);
    });

    if (block) warnings.push({ line: block.line, message: 'Block not terminated by "!"', text: block.kind + ' ' + block.id });
    return { globals: globals, blocks: blocks, warnings: warnings };
  }

  /* ---------- Blocks ---------- */

  function portListStatement(stmt, keyword, warnings) {
    const rest = stmt.text.slice(keyword.length).trim();
    const ports = parsePortList(rest);
    if (!ports) warnings.push({ line: stmt.line, message: 'Unreadable port list', text: stmt.text });
    return ports || [];
  }

  function parseVlan(block, warnings) {
    const vlan = { id: Number(block.id), name: '', fixed: [], tagged: [], untagged: null, forbidden: [], other: [] };
    block.statements.forEach(function (stmt) {
      const m = /^(name|fixed|tagged|untagged|forbidden)(?:\s+(.*))?$/i.exec(stmt.text);
      if (!m) {
        vlan.other.push(stmt.text);
        return;
      }
      const keyword = m[1].toLowerCase();
      if (keyword === 'name') vlan.name = (m[2] || '').trim();
      else vlan[keyword] = portListStatement(stmt, m[1], warnings);
    });
    return vlan;
  }

  function parseInterface(block) {
    const iface = { name: block.id, settings: {}, other: [] };
    const port = PORT_INTERFACE.exec(block.id);
    if (port) {
      iface.type = port[1].toLowerCase();
      iface.port = Number(port[4]);
      iface.unit = Number(port[2]);
      iface.slot = Number(port[3]);
    } else {
      iface.type = 'management';
    }

    block.statements.forEach(function (stmt) {
      const text = stmt.text;
      let m;
      if ((m = /^acceptable frame type\s+(\S+)$/i.exec(text))) iface.settings.acceptableFrames = m[1].toLowerCase();
      else if ((m = /^pvid\s+(\d+)$/i.exec(text))) iface.settings.pvid = Number(m[1]);
      else if ((m = /^ip address default-gateway\s+(\S+)$/i.exec(text))) iface.settings.gateway = m[1];
      else if (/^ip address dhcp$/i.test(text)) iface.settings.dhcp = true;
      else if ((m = /^ip address\s+(\S+)$/i.exec(text))) iface.settings.address = m[1];
      else if ((m = /^description\s+(.+)$/i.exec(text))) iface.settings.description = m[1];
      else if (/^shutdown$/i.test(text)) iface.settings.shutdown = true;
      else iface.other.push(text);
    });
    return iface;
  }

  function parseRing(block) {
    const ring = { id: Number(block.id), enabled: null, uuid: null, ports: [], vlan: null, role: null, other: [] };
    block.statements.forEach(function (stmt) {
      const text = stmt.text;
      let m;
      if ((m = /^(no\s+)?ring enable$/i.exec(text))) ring.enabled = !m[1];
      else if ((m = /^ring uuid\s+(\S+)$/i.exec(text))) ring.uuid = m[1];
      else if ((m = /^ring port-(\d+)\s+(\d+)$/i.exec(text))) ring.ports[Number(m[1]) - 1] = Number(m[2]);
      else if ((m = /^ring vlan\s+(\d+)$/i.exec(text))) ring.vlan = Number(m[1]);
      else if ((m = /^ring role\s+(\S+)$/i.exec(text))) ring.role = m[1];
      else ring.other.push(text);
    });
    ring.ports = ring.ports.filter(function (p) { return p !== undefined; });
    return ring;
  }

  /* ---------- Global statements ---------- */

  function parseGlobals(statements) {
    const result = { model: null, features: {}, other: [] };
    statements.forEach(function (stmt) {
      const text = stmt.text;
      let m;
      if ((m = /^model-name\s+(\S+)$/i.exec(text))) result.model = m[1];
      // "<feature> enable" / "no <feature> enable", e.g. "lldp enable", "profinet enable"
      else if ((m = /^(no\s+)?([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\s+enable$/i.exec(text))) result.features[m[2].toLowerCase()] = !m[1];
      else result.other.push(text);
    });
    return result;
  }

  /* ---------- Ports (derived) ---------- */

  /**
   * One entry per physical port with its effective VLAN setup. Defaults follow the switch
   * defaults: PVID 1, acceptable frame type "all".
   */
  function buildPorts(interfaces, vlans, rings, model) {
    const info = modelInfo(model);
    const byNumber = new Map();
    interfaces.filter(function (i) { return i.port !== undefined; }).forEach(function (i) { byNumber.set(i.port, i); });
    // Ports only mentioned in VLAN lists still exist on the device.
    vlans.forEach(function (v) {
      v.fixed.concat(v.tagged, v.forbidden, v.untagged || []).forEach(function (p) {
        if (!byNumber.has(p)) byNumber.set(p, { name: 'port ' + p, type: null, port: p, settings: {}, other: [] });
      });
    });

    return Array.from(byNumber.keys()).sort(function (a, b) { return a - b; }).map(function (number) {
      const iface = byNumber.get(number);
      const settings = iface.settings;
      const memberships = [];
      vlans.forEach(function (v) {
        const member = v.fixed.indexOf(number) !== -1 || (v.untagged && v.untagged.indexOf(number) !== -1);
        if (!member) return;
        const tagged = v.tagged.indexOf(number) !== -1;
        memberships.push({ vlan: v.id, tagged: tagged });
      });
      const forbidden = vlans.filter(function (v) { return v.forbidden.indexOf(number) !== -1; }).map(function (v) { return v.id; });
      const ring = rings.find(function (r) { return r.ports.indexOf(number) !== -1; }) || null;
      const pvid = settings.pvid !== undefined ? settings.pvid : 1;
      const pvidMember = memberships.some(function (m) { return m.vlan === pvid && !m.tagged; });

      let media = null;
      if (info && info.sfpPorts.indexOf(number) !== -1) media = 'sfp';
      else if (iface.type === 'fastethernet') media = '100';
      else if (iface.type === 'gigabitethernet') media = '1000';
      else if (iface.type === 'tengigabitethernet') media = '10000';

      return {
        number: number,
        name: iface.name,
        type: iface.type,
        media: media,
        description: settings.description || '',
        shutdown: !!settings.shutdown,
        pvid: pvid,
        pvidConfigured: settings.pvid !== undefined,
        pvidMember: pvidMember,
        acceptableFrames: settings.acceptableFrames || 'all',
        acceptableFramesConfigured: settings.acceptableFrames !== undefined,
        untagged: memberships.filter(function (m) { return !m.tagged; }).map(function (m) { return m.vlan; }),
        tagged: memberships.filter(function (m) { return m.tagged; }).map(function (m) { return m.vlan; }),
        forbidden: forbidden,
        ring: ring ? { id: ring.id, enabled: ring.enabled } : null,
        other: iface.other,
      };
    });
  }

  /* ---------- Entry points ---------- */

  /** Cheap check whether a text file is a WAGO switch config. */
  function detect(text) {
    const s = String(text);
    if (/^model-name\s+852-/im.test(s)) return true;
    return /^vlan\s+\d+\s*$/im.test(s) && /^interface\s+(fast|gigabit)ethernet\d+\/\d+\/\d+\s*$/im.test(s) && /^!\s*$/m.test(s);
  }

  function parseConfig(text) {
    const tokens = tokenize(text);
    const warnings = tokens.warnings;
    const vlans = [];
    const interfaces = [];
    const rings = [];

    tokens.blocks.forEach(function (block) {
      if (block.kind === 'vlan') vlans.push(parseVlan(block, warnings));
      else if (block.kind === 'interface') interfaces.push(parseInterface(block));
      else rings.push(parseRing(block));
    });
    vlans.sort(function (a, b) { return a.id - b.id; });

    const globals = parseGlobals(tokens.globals);
    const management = interfaces.filter(function (i) { return i.type === 'management'; });
    const info = modelInfo(globals.model);

    return {
      model: globals.model,
      modelDescription: info ? info.description : null,
      features: globals.features,
      otherGlobals: globals.other,
      vlans: vlans,
      interfaces: interfaces,
      management: management,
      rings: rings,
      ports: buildPorts(interfaces, vlans, rings, globals.model),
      warnings: warnings,
    };
  }

  const api = { detect: detect, parseConfig: parseConfig, parsePortList: parsePortList, modelInfo: modelInfo };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RouterLens = root.RouterLens || {};
    root.RouterLens.wagoSwitch = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
