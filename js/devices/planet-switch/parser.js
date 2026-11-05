/*
 * PLANET managed switch (GS-4210 series and siblings) configuration parser.
 *
 * The switch exports its running configuration as "running-config.cfg": CLI statements framed by
 * "SYSTEM CONFIG FILE ::= BEGIN". Only settings that differ from the factory default are written.
 * A statement at column 0 opens a context, indented lines below it belong to that context;
 * "!" lines are separators, "! Key: value" lines in the header carry system information.
 *
 *   ! System Description: PLANET GS421024PL4C Switch
 *   system name "GS-4210-24PL4C"
 *   vlan 10
 *    name "Office"
 *   poe port enable 1
 *   interface gi1
 *    switchport mode access
 *    switchport access vlan 20
 *    description "Uplink"
 *
 * Port defaults: VLAN mode trunk with native VLAN 1 (a port with only
 * "switchport trunk allowed vlan add 10-11" carries VLAN 1 untagged and 10, 11 tagged);
 * access VLAN 1; hybrid PVID 1.
 *
 * Statements that are not interpreted are kept (`other`) so the views can still show them.
 * Secrets (password hashes, SNMP community names) are parsed but flagged, never needed for display.
 * Runs in the browser (global `RouterLens.planetSwitch`) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  /** Physical / logical interface names: "gi1", "fa3", "te2", "lag1" (also long forms). */
  const INTERFACE_NAME = /^(fa|fastethernet|gi|gigabitethernet|te|tengigabitethernet|lag|port-channel)(\d+)$/i;
  const INTERFACE_TYPE = {
    fa: 'fastethernet', fastethernet: 'fastethernet',
    gi: 'gigabitethernet', gigabitethernet: 'gigabitethernet',
    te: 'tengigabitethernet', tengigabitethernet: 'tengigabitethernet',
    lag: 'lag', 'port-channel': 'lag',
  };

  /** Known models, keyed by the model name without dashes ("GS-4210-24PL4C" → "GS421024PL4C"). */
  const MODELS = {
    GS421024PL4C: {
      name: 'GS-4210-24PL4C',
      description: 'L2+ managed switch, 24 × 10/100/1000BASE-T 802.3at PoE+ + 4 × 100/1000BASE-X SFP',
      sfpPorts: [25, 26, 27, 28],
      poePorts: range(1, 24),
    },
  };

  function range(from, to) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  }

  function modelKey(model) {
    return String(model || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  function modelInfo(model) {
    return MODELS[modelKey(model)] || null;
  }

  /** "1-8,10" → [1, 2, 3, 4, 5, 6, 7, 8, 10]; returns null when the list is not numeric. */
  function parseList(text) {
    const out = [];
    const parts = String(text).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    for (const part of parts) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part);
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] !== undefined ? Number(m[2]) : from;
      for (let p = Math.min(from, to); p <= Math.max(from, to); p++) {
        if (out.indexOf(p) === -1) out.push(p);
      }
    }
    return out.sort(function (a, b) { return a - b; });
  }

  /** Interface list as used in global statements: "1-24", "gi1-24", "gi1,gi3" → port numbers. */
  function parsePortList(text) {
    return parseList(String(text).replace(/\b(?:fa|gi|te)(?=\d)/gi, ''));
  }

  /** Removes the surrounding quotes of a CLI string argument. */
  function unquote(text) {
    const s = String(text || '').trim();
    const m = /^"(.*)"$/.exec(s);
    return m ? m[1] : s;
  }

  /* ---------- Tokenizer ---------- */

  /**
   * Splits the file into top-level statements, each with its indented child lines,
   * plus the "! Key: value" header lines.
   */
  function tokenize(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    const statements = [];
    const header = {};
    let current = null;

    lines.forEach(function (raw, i) {
      if (!raw.trim()) return;
      const line = raw.trim();
      if (line.charAt(0) === '!') {
        current = null;
        const m = /^!\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
        if (m) header[m[1].toLowerCase()] = m[2].trim();
        return;
      }
      if (/^SYSTEM CONFIG FILE ::= (BEGIN|END)$/i.test(line) || /^END$/i.test(line)) return;

      const statement = { line: i + 1, text: line, children: [] };
      if (/^\s/.test(raw) && current) {
        current.children.push(statement);
        return;
      }
      // An indented line without an open context (e.g. " ip http secure-redirect" after "!")
      // is a global statement of its own.
      statements.push(statement);
      current = statement;
    });
    return { statements: statements, header: header };
  }

  /* ---------- Interfaces ---------- */

  function newInterface(name) {
    const m = INTERFACE_NAME.exec(name);
    return {
      name: name,
      type: m ? INTERFACE_TYPE[m[1].toLowerCase()] : 'other',
      port: m ? Number(m[2]) : null,
      description: '',
      shutdown: false,
      mode: null, // as configured; null = switch default (trunk)
      accessVlan: null,
      nativeVlan: null,
      trunkAllowed: { all: false, add: [], remove: [] },
      hybridPvid: null,
      hybridTagged: [],
      hybridUntagged: [],
      other: [],
    };
  }

  function vlanListArg(stmt, text, warnings) {
    const list = /^(all|none)$/i.test(text) ? text.toLowerCase() : parseList(text);
    if (!list) warnings.push({ line: stmt.line, message: 'Unreadable VLAN list', text: stmt.text });
    return list;
  }

  function addTo(list, items) {
    items.forEach(function (v) { if (list.indexOf(v) === -1) list.push(v); });
    list.sort(function (a, b) { return a - b; });
  }

  function removeFrom(list, items) {
    for (let i = list.length - 1; i >= 0; i--) if (items.indexOf(list[i]) !== -1) list.splice(i, 1);
  }

  function parseInterfaceStatement(iface, stmt, warnings) {
    const text = stmt.text;
    let m;
    if ((m = /^description\s+(.+)$/i.exec(text))) iface.description = unquote(m[1]);
    else if (/^no description$/i.test(text)) iface.description = '';
    else if ((m = /^(no\s+)?shutdown$/i.exec(text))) iface.shutdown = !m[1];
    else if ((m = /^switchport mode\s+(access|trunk|hybrid|tunnel|general)$/i.exec(text))) iface.mode = m[1].toLowerCase();
    else if ((m = /^switchport access vlan\s+(\d+)$/i.exec(text))) iface.accessVlan = Number(m[1]);
    else if ((m = /^switchport trunk native vlan\s+(\d+)$/i.exec(text))) iface.nativeVlan = Number(m[1]);
    else if ((m = /^switchport trunk allowed vlan\s+(?:(add|remove)\s+)?(\S+)$/i.exec(text))) {
      const list = vlanListArg(stmt, m[2], warnings);
      const allowed = iface.trunkAllowed;
      if (!list) return;
      if (list === 'all') {
        allowed.all = !m[1] || m[1].toLowerCase() === 'add';
        if (!allowed.all) allowed.add = [];
        allowed.remove = [];
      } else if (list === 'none') {
        allowed.all = false;
        allowed.add = [];
      } else if (m[1] && m[1].toLowerCase() === 'remove') {
        removeFrom(allowed.add, list);
        addTo(allowed.remove, list);
      } else {
        if (!m[1]) allowed.add = []; // plain "allowed vlan <list>" replaces the list
        addTo(allowed.add, list);
        removeFrom(allowed.remove, list);
      }
    } else if ((m = /^switchport hybrid pvid\s+(\d+)$/i.exec(text))) iface.hybridPvid = Number(m[1]);
    else if ((m = /^switchport hybrid allowed vlan\s+(add|remove)\s+(\S+)(?:\s+(tagged|untagged))?$/i.exec(text))) {
      const list = vlanListArg(stmt, m[2], warnings);
      if (!list || typeof list === 'string') return;
      if (m[1].toLowerCase() === 'remove') {
        removeFrom(iface.hybridTagged, list);
        removeFrom(iface.hybridUntagged, list);
      } else if ((m[3] || 'tagged').toLowerCase() === 'untagged') {
        addTo(iface.hybridUntagged, list);
        removeFrom(iface.hybridTagged, list);
      } else {
        addTo(iface.hybridTagged, list);
        removeFrom(iface.hybridUntagged, list);
      }
    } else iface.other.push(text);
  }

  /* ---------- Global statements ---------- */

  function emptyResult() {
    return {
      systemName: null,
      management: { address: null, mask: null, dhcp: false, gateway: null, dns: [] },
      users: [],
      vlans: new Map(),
      interfaces: new Map(),
      snmp: { enabled: null, communities: [] },
      poe: { adminMode: null, limitMode: null, temperatureThreshold: null, ports: new Map(), other: [] },
      spanningTree: { enabled: null, mode: null, mstName: null, mstRevision: null, other: [] },
      voiceVlan: { enabled: null, vlan: null, oui: [], other: [] },
      services: { httpSecureRedirect: false, other: [] },
      other: [],
    };
  }

  function poePort(result, number) {
    if (!result.poe.ports.has(number)) result.poe.ports.set(number, { enabled: null, priority: null });
    return result.poe.ports.get(number);
  }

  function vlanEntry(result, id) {
    if (!result.vlans.has(id)) result.vlans.set(id, { id: id, name: '', other: [] });
    return result.vlans.get(id);
  }

  function parseUser(text) {
    // username "admin" [privilege 15] secret encrypted <hash> | password <...>
    const m = /^username\s+("[^"]*"|\S+)(.*)$/i.exec(text);
    if (!m) return null;
    const rest = m[2];
    const privilege = /\bprivilege\s+(\d+)/i.exec(rest);
    let credential = 'none';
    if (/\bsecret\s+encrypted\b/i.test(rest)) credential = 'secret-encrypted';
    else if (/\bsecret\b/i.test(rest)) credential = 'secret';
    else if (/\bpassword\s+encrypted\b/i.test(rest)) credential = 'password-encrypted';
    else if (/\bpassword\b/i.test(rest)) credential = 'password';
    return { name: unquote(m[1]), privilege: privilege ? Number(privilege[1]) : null, credential: credential };
  }

  function parseStatement(result, stmt, warnings) {
    const text = stmt.text;
    let m;

    if ((m = /^interface\s+(\S+)$/i.exec(text))) {
      const name = m[1].toLowerCase();
      if (!result.interfaces.has(name)) result.interfaces.set(name, newInterface(name));
      const iface = result.interfaces.get(name);
      stmt.children.forEach(function (child) { parseInterfaceStatement(iface, child, warnings); });
      return;
    }
    if ((m = /^vlan\s+([\d,-]+)$/i.exec(text))) {
      const ids = parseList(m[1]);
      if (!ids) {
        warnings.push({ line: stmt.line, message: 'Unreadable VLAN list', text: text });
        result.other.push(text);
        return;
      }
      ids.forEach(function (id) {
        const vlan = vlanEntry(result, id);
        stmt.children.forEach(function (child) {
          const n = /^name\s+(.+)$/i.exec(child.text);
          if (n && ids.length === 1) vlan.name = unquote(n[1]);
          else vlan.other.push(child.text);
        });
      });
      return;
    }
    if (/^spanning-tree mst configuration$/i.test(text)) {
      stmt.children.forEach(function (child) {
        const n = /^name\s+(.+)$/i.exec(child.text);
        const r = /^revision\s+(\d+)$/i.exec(child.text);
        if (n) result.spanningTree.mstName = unquote(n[1]);
        else if (r) result.spanningTree.mstRevision = Number(r[1]);
        else result.spanningTree.other.push(child.text);
      });
      return;
    }

    // Everything below is a single-line statement; indented children are kept verbatim.
    const keep = function (list) {
      list.push(text);
      stmt.children.forEach(function (c) { list.push('  ' + c.text); });
    };

    if ((m = /^system name\s+(.+)$/i.exec(text))) result.systemName = unquote(m[1]);
    else if ((m = /^ip address\s+(\S+)\s+mask\s+(\S+)$/i.exec(text))) {
      result.management.address = m[1];
      result.management.mask = m[2];
    } else if ((m = /^ip address\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)$/i.exec(text))) {
      result.management.address = m[1];
      result.management.mask = m[2];
    } else if ((m = /^(no\s+)?ip (?:address )?dhcp$/i.exec(text))) result.management.dhcp = !m[1];
    else if ((m = /^ip default-gateway\s+(\S+)$/i.exec(text))) result.management.gateway = m[1];
    else if ((m = /^ip dns\s+(.+)$/i.exec(text))) result.management.dns = m[1].trim().split(/\s+/);
    else if (/^username\s/i.test(text)) {
      const user = parseUser(text);
      if (user) {
        result.users = result.users.filter(function (u) { return u.name !== user.name; });
        result.users.push(user);
      } else keep(result.other);
    } else if ((m = /^no username\s+("[^"]*"|\S+)$/i.exec(text))) {
      const name = unquote(m[1]);
      result.users = result.users.filter(function (u) { return u.name !== name; });
    } else if ((m = /^(no\s+)?snmp$/i.exec(text))) result.snmp.enabled = !m[1];
    else if ((m = /^snmp community\s+("[^"]*"|\S+)(?:\s+(.*))?$/i.exec(text))) {
      const name = unquote(m[1]);
      const access = /\brw\b/i.test(m[2] || '') ? 'rw' : 'ro';
      result.snmp.communities = result.snmp.communities.filter(function (c) { return c.name !== name; });
      result.snmp.communities.push({ name: name, access: access, wellKnown: /^(public|private)$/i.test(name) });
    } else if ((m = /^no snmp community\s+("[^"]*"|\S+)$/i.exec(text))) {
      const name = unquote(m[1]);
      result.snmp.communities = result.snmp.communities.filter(function (c) { return c.name !== name; });
    } else if ((m = /^poe admin-mode\s+(\S+)$/i.exec(text))) result.poe.adminMode = m[1].toLowerCase();
    else if ((m = /^poe limit-mode\s+(\S+)$/i.exec(text))) result.poe.limitMode = m[1].toLowerCase();
    else if ((m = /^poe temperature[_-]threshold\s+(\d+)$/i.exec(text))) result.poe.temperatureThreshold = Number(m[1]);
    else if ((m = /^(no\s+)?poe port (enable|disable)\s+(.+)$/i.exec(text))) {
      const ports = parsePortList(m[3]);
      if (!ports) {
        warnings.push({ line: stmt.line, message: 'Unreadable port list', text: text });
        keep(result.poe.other);
        return;
      }
      const enabled = !m[1] && m[2].toLowerCase() === 'enable';
      ports.forEach(function (p) { poePort(result, p).enabled = enabled; });
    } else if ((m = /^poe priority\s+(critical|high|medium|low)\s+(.+)$/i.exec(text))) {
      const ports = parsePortList(m[2]);
      if (!ports) {
        warnings.push({ line: stmt.line, message: 'Unreadable port list', text: text });
        keep(result.poe.other);
        return;
      }
      ports.forEach(function (p) { poePort(result, p).priority = m[1].toLowerCase(); });
    } else if (/^poe\s/i.test(text)) keep(result.poe.other);
    else if ((m = /^(no\s+)?spanning-tree$/i.exec(text))) result.spanningTree.enabled = !m[1];
    else if ((m = /^spanning-tree mode\s+(\S+)$/i.exec(text))) result.spanningTree.mode = m[1].toLowerCase();
    else if (/^(no\s+)?spanning-tree\s/i.test(text)) keep(result.spanningTree.other);
    else if ((m = /^voice-vlan oui-table\s+([0-9a-f]{2}(?::[0-9a-f]{2}){2})(?:\s+(.*))?$/i.exec(text))) {
      result.voiceVlan.oui.push({ oui: m[1].toUpperCase(), description: unquote(m[2] || '') });
    } else if ((m = /^(no\s+)?voice-vlan$/i.exec(text))) result.voiceVlan.enabled = !m[1];
    else if ((m = /^voice-vlan vlan\s+(\d+)$/i.exec(text))) result.voiceVlan.vlan = Number(m[1]);
    else if (/^(no\s+)?voice-vlan\s/i.test(text)) keep(result.voiceVlan.other);
    else if ((m = /^(no\s+)?ip http secure-redirect$/i.exec(text))) result.services.httpSecureRedirect = !m[1];
    else if (/^(no\s+)?ip (http|ssh|telnet)\b/i.test(text)) keep(result.services.other);
    else keep(result.other);
  }

  /* ---------- Ports (derived) ---------- */

  /** Effective VLAN membership of one interface, applying the switch defaults. */
  function membership(iface, vlanIds) {
    const mode = iface.mode || 'trunk';
    if (mode === 'access') {
      const vlan = iface.accessVlan !== null ? iface.accessVlan : 1;
      return { mode: mode, pvid: vlan, untagged: [vlan], tagged: [] };
    }
    if (mode === 'trunk') {
      const native = iface.nativeVlan !== null ? iface.nativeVlan : 1;
      const allowed = iface.trunkAllowed;
      let tagged = allowed.all ? vlanIds.filter(function (id) { return allowed.remove.indexOf(id) === -1; }) : allowed.add.slice();
      tagged = tagged.filter(function (id) { return id !== native; });
      const untagged = allowed.remove.indexOf(native) === -1 ? [native] : [];
      return { mode: mode, pvid: native, untagged: untagged, tagged: tagged };
    }
    if (mode === 'hybrid' || mode === 'general') {
      const pvid = iface.hybridPvid !== null ? iface.hybridPvid : 1;
      return { mode: mode, pvid: pvid, untagged: iface.hybridUntagged.slice(), tagged: iface.hybridTagged.slice() };
    }
    // tunnel (QinQ): the access VLAN is the service VLAN
    const svlan = iface.accessVlan !== null ? iface.accessVlan : 1;
    return { mode: mode, pvid: svlan, untagged: [svlan], tagged: [] };
  }

  function mediaOf(iface, info) {
    if (iface.type === 'lag') return 'lag';
    if (info && info.sfpPorts.indexOf(iface.port) !== -1) return 'sfp';
    if (iface.type === 'fastethernet') return '100';
    if (iface.type === 'gigabitethernet') return '1000';
    if (iface.type === 'tengigabitethernet') return '10000';
    return null;
  }

  function buildPorts(interfaces, vlans, poe, info) {
    const vlanIds = vlans.map(function (v) { return v.id; });
    const physical = interfaces.filter(function (i) { return i.port !== null && i.type !== 'lag'; });
    // PoE settings may mention ports without an interface block.
    poe.ports.forEach(function (_, number) {
      if (!physical.some(function (i) { return i.port === number; })) physical.push(newInterface('gi' + number));
    });
    physical.sort(function (a, b) { return a.port - b.port; });

    return physical.map(function (iface) {
      const vm = membership(iface, vlanIds);
      const poeConfig = poe.ports.get(iface.port) || null;
      const poeCapable = info ? info.poePorts.indexOf(iface.port) !== -1 : poeConfig !== null;
      const undefinedVlans = vm.untagged.concat(vm.tagged).filter(function (id) { return vlanIds.indexOf(id) === -1; });
      return {
        number: iface.port,
        name: iface.name,
        type: iface.type,
        media: mediaOf(iface, info),
        description: iface.description,
        shutdown: iface.shutdown,
        mode: vm.mode,
        modeConfigured: iface.mode !== null,
        pvid: vm.pvid,
        pvidMember: vm.untagged.indexOf(vm.pvid) !== -1,
        untagged: vm.untagged,
        tagged: vm.tagged,
        undefinedVlans: undefinedVlans,
        poe: poeCapable || poeConfig
          ? { capable: poeCapable, enabled: poeConfig ? poeConfig.enabled : null, priority: poeConfig ? poeConfig.priority : null }
          : null,
        other: iface.other,
      };
    });
  }

  /* ---------- Entry points ---------- */

  /** Cheap check whether a text file is a PLANET switch running-config. */
  function detect(text) {
    const s = String(text).slice(0, 4000);
    if (/^!\s*System Description:\s*PLANET\b/im.test(s)) return true;
    return /^SYSTEM CONFIG FILE ::= BEGIN\s*$/m.test(s) && /^interface\s+(fa|gi|te)\d+\s*$/im.test(String(text));
  }

  /** "PLANET GS421024PL4C Switch" → "GS421024PL4C". */
  function modelFromDescription(description) {
    const m = /^PLANET\s+(\S+)/i.exec(description || '');
    return m ? m[1] : null;
  }

  function parseConfig(text) {
    const tokens = tokenize(text);
    const warnings = [];
    const result = emptyResult();
    tokens.statements.forEach(function (stmt) { parseStatement(result, stmt, warnings); });

    const header = tokens.header;
    const rawModel = modelFromDescription(header['system description']);
    const info = modelInfo(rawModel) || modelInfo(result.systemName);
    const vlans = Array.from(result.vlans.values()).sort(function (a, b) { return a.id - b.id; });
    const interfaces = Array.from(result.interfaces.values());

    return {
      model: info ? info.name : rawModel,
      modelDescription: info ? info.description : null,
      system: {
        description: header['system description'] || null,
        version: header['system version'] || null,
        uptime: header['system up time'] || null,
        name: result.systemName || header['system name'] || null,
      },
      management: result.management,
      users: result.users,
      snmp: result.snmp,
      poe: {
        adminMode: result.poe.adminMode,
        limitMode: result.poe.limitMode,
        temperatureThreshold: result.poe.temperatureThreshold,
        other: result.poe.other,
      },
      spanningTree: result.spanningTree,
      voiceVlan: result.voiceVlan,
      services: result.services,
      vlans: vlans,
      interfaces: interfaces,
      lags: interfaces.filter(function (i) { return i.type === 'lag'; }),
      ports: buildPorts(interfaces, vlans, result.poe, info),
      otherGlobals: result.other,
      warnings: warnings,
    };
  }

  const api = { detect: detect, parseConfig: parseConfig, parseList: parseList, parsePortList: parsePortList, modelInfo: modelInfo };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RouterLens = root.RouterLens || {};
    root.RouterLens.planetSwitch = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
