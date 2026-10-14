/*
 * Securepoint UTM report parser.
 *
 * Input: pages -> lines -> cells ({ x, text }) as produced by securepoint/pdf-extract.js.
 * The report is a sequence of tables, each introduced by a title line that is listed in the
 * table of contents (page 2) followed by a header line. Cells are assigned to columns by
 * their x position relative to the header cells, so empty cells survive. A table row may
 * span several lines (list values such as zones or group members); a line without a cell in
 * the first column continues the previous row.
 *
 * Runs in the browser (global `RouterLens.securepoint`) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const TITLE_PATTERN = /^Securepoint UTM\s*v?\s*(\d[\d.]*)\s+Report$/i;
  const COLUMN_TOLERANCE = 2.5; // pt a cell may start left of its header cell
  const AUTO_GENERATED = /\s*~auto-generated~\s*/;
  const ACTIONS = ['ACCEPT', 'DROP', 'REJECT'];
  const NAT_TYPES = ['HIDENAT', 'DNAT', 'SNAT', 'NETMAP'];

  /* ---------- Detection ---------- */

  function lineText(cells) {
    return cells.map(function (c) { return c.text; }).join(' ');
  }

  /**
   * Checks whether the pages are a Securepoint UTM report.
   * The title on page 1, the table of contents and the "System info" table must all be there.
   * @returns {{version: string, generated: string}|null}
   */
  function detect(pages) {
    if (!Array.isArray(pages) || pages.length < 3) return null;
    let version = null;
    let generated = '';
    pages[0].forEach(function (cells) {
      const match = TITLE_PATTERN.exec(lineText(cells));
      if (match) version = match[1];
      else if (/^\d{1,2}\.\s+\w+\s+\d{4}/.test(lineText(cells))) generated = lineText(cells);
    });
    if (!version) return null;
    const toc = findToc(pages);
    if (!toc || toc.titles.indexOf('System info') === -1) return null;
    return { version: version, generated: generated };
  }

  /** Table of contents: lines of "<title> <page number>" below "Table of contents". */
  function findToc(pages) {
    for (let p = 0; p < Math.min(pages.length, 3); p++) {
      const lines = pages[p];
      const start = lines.findIndex(function (cells) { return lineText(cells) === 'Table of contents'; });
      if (start === -1) continue;
      const titles = [];
      for (let i = start + 1; i < lines.length; i++) {
        const cells = lines[i];
        const last = cells[cells.length - 1].text;
        if (cells.length === 2 && /^\d+$/.test(last)) titles.push(cells[0].text);
        else if (cells.length === 1 && !/^\d+$/.test(cells[0].text)) titles.push(cells[0].text); // e.g. last entry without page
      }
      return { page: p, titles: titles };
    }
    return null;
  }

  /* ---------- Generic table reader ---------- */

  function isPageNumber(cells) {
    return cells.length === 1 && /^\d+$/.test(cells[0].text) && cells[0].x > 500;
  }

  function sameHeader(cells, header) {
    return cells.length === header.length && cells.every(function (c, i) { return c.text === header[i].name; });
  }

  /**
   * Reads every table below the table of contents.
   * @returns {Map<string, Array<Object<string, string[]>>>} title -> records (column name -> lines of text)
   */
  function readTables(pages, options) {
    const toc = findToc(pages);
    const titles = new Set(toc.titles);
    const tables = new Map();
    const fillDown = (options && options.fillDown) || {};
    let current = null;

    for (let p = toc.page + 1; p < pages.length; p++) {
      pages[p].forEach(function (cells) {
        if (isPageNumber(cells)) return;
        if (cells.length === 1 && titles.has(cells[0].text) && !tables.has(cells[0].text)) {
          current = { title: cells[0].text, header: null, records: [] };
          tables.set(current.title, current.records);
          return;
        }
        if (!current) return;
        const table = current;
        if (!table.header) {
          table.header = cells.map(function (c) { return { name: c.text, x: c.x }; });
          return;
        }
        if (sameHeader(cells, table.header)) {
          table.header = cells.map(function (c) { return { name: c.text, x: c.x }; });
          return;
        }
        addLine(table, cells, fillDown[table.title]);
      });
    }
    return tables;
  }

  function columnOf(header, x) {
    let index = 0;
    for (let i = 0; i < header.length; i++) {
      if (header[i].x <= x + COLUMN_TOLERANCE) index = i;
    }
    return index;
  }

  function addLine(table, cells, fillColumn) {
    const byColumn = {};
    cells.forEach(function (c) {
      const name = table.header[columnOf(table.header, c.x)].name;
      (byColumn[name] = byColumn[name] || []).push(c.text);
    });
    const firstName = table.header[0].name;
    const records = table.records;
    // Tables like "Application variables" repeat only the last non-empty first-column value.
    const startsRecord = fillColumn ? true : !!byColumn[firstName];
    if (fillColumn) {
      if (byColumn[fillColumn]) table.lastFill = byColumn[fillColumn];
      else if (table.lastFill) byColumn[fillColumn] = table.lastFill;
    }
    if (startsRecord) {
      records.push(byColumn);
    } else if (records.length) {
      const last = records[records.length - 1];
      Object.keys(byColumn).forEach(function (name) {
        last[name] = (last[name] || []).concat(byColumn[name]);
      });
    }
  }

  /* ---------- Record helpers ---------- */

  function text(record, name) {
    return record[name] ? record[name].join(' ') : '';
  }

  function list(record, name) {
    return record[name] ? record[name].slice() : [];
  }

  function splitProps(lines) {
    const props = {};
    lines.forEach(function (line) {
      const i = line.indexOf('=');
      if (i > 0) props[line.slice(0, i)] = line.slice(i + 1);
    });
    return props;
  }

  function toNumber(value) {
    return /^\d+$/.test(value) ? Number(value) : null;
  }

  /* ---------- IPv4 helpers ---------- */

  function ipToInt(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(function (n) { return !(n >= 0 && n <= 255); })) return null;
    return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
  }

  function intToIp(n) {
    return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
  }

  /** "192.168.33.1/24" -> "192.168.33.0/24"; returns the input when it cannot be parsed. */
  function networkOf(cidr) {
    const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(cidr);
    if (!m) return cidr;
    const ip = ipToInt(m[1]);
    const bits = Number(m[2]);
    if (ip === null || bits > 32) return cidr;
    const size = Math.pow(2, 32 - bits);
    return intToIp(Math.floor(ip / size) * size) + '/' + bits;
  }

  /* ---------- Report model ---------- */

  function parseReport(pages) {
    const info = detect(pages);
    if (!info) throw new Error('Not a Securepoint UTM report');
    const tables = readTables(pages, { fillDown: { 'Application variables': 'application' } });
    const rows = function (title) { return tables.get(title) || []; };

    const system = {};
    rows('System info').forEach(function (r) { system[text(r, 'attribute')] = text(r, 'value'); });

    const report = {
      device: 'securepoint',
      version: info.version,
      generated: info.generated,
      system: system,
      users: rows('Users').map(function (r) {
        return {
          name: text(r, 'name'),
          id: toNumber(text(r, 'id')),
          groups: text(r, 'groups').split(/[,\s]+/).filter(Boolean),
          permission: text(r, 'permission'),
        };
      }),
      userGroups: rows('User groups').map(function (r) {
        return {
          id: toNumber(text(r, 'id')),
          name: text(r, 'name'),
          directoryName: text(r, 'directory_name'),
          permission: text(r, 'permission'),
        };
      }),
      addresses: rows('Adresses').map(function (r) {
        return { id: toNumber(text(r, 'id')), device: text(r, 'device'), address: text(r, 'address'), flags: list(r, 'flags') };
      }),
      routes: rows('Routes').map(function (r) {
        return {
          id: toNumber(text(r, 'id')),
          source: text(r, 'src'),
          destination: text(r, 'dst'),
          gateway: text(r, 'router'),
          device: text(r, 'device'),
          viaDevice: text(r, 'via_device'),
          weight: toNumber(text(r, 'weight')),
          flags: list(r, 'flags'),
        };
      }),
      zones: rows('Zones').map(function (r) {
        return { id: toNumber(text(r, 'id')), name: text(r, 'name'), interface: text(r, 'interface'), flags: list(r, 'flags') };
      }),
      nodes: rows('Nodes').map(function (r) {
        return { id: toNumber(text(r, 'id')), name: text(r, 'name'), address: text(r, 'address'), zone: text(r, 'zone') };
      }),
      nodeGroups: rows('Node groups').map(function (r) {
        return { id: toNumber(text(r, 'id')), name: text(r, 'name'), members: list(r, 'nodes') };
      }),
      services: rows('Firewall services').map(function (r) {
        return {
          id: toNumber(text(r, 'id')),
          name: text(r, 'name'),
          protocol: text(r, 'proto'),
          helper: text(r, 'ct_helper'),
          ports: list(r, 'dst-ports'),
          icmpTypes: list(r, 'icmp-types'),
          sourcePorts: list(r, 'src-ports'),
        };
      }),
      serviceGroups: rows('Firewall service groups').map(function (r) {
        return { id: toNumber(text(r, 'id')), name: text(r, 'name'), description: text(r, 'descr'), members: list(r, 'services') };
      }),
      ruleGroups: rows('Firewall rule groups').map(function (r) {
        const flags = list(r, 'flags');
        const rawName = text(r, 'name');
        return {
          pos: toNumber(text(r, 'pos')),
          id: toNumber(text(r, 'id')),
          name: rawName.replace(AUTO_GENERATED, '').trim(),
          autoGenerated: AUTO_GENERATED.test(rawName),
          enabled: flags.indexOf('DISABLED') === -1,
          flags: flags,
          count: toNumber(text(r, 'count')),
          rules: [],
        };
      }),
      globals: {},
      applications: [],
    };

    rows('Global variables').forEach(function (r) { report.globals[text(r, 'variable')] = r.value ? r.value.join('\n') : ''; });
    report.applications = rows('Application variables').map(function (r) {
      return { application: text(r, 'application'), variable: text(r, 'variable'), value: r.value ? r.value.join('\n') : '' };
    });

    report.interfaces = rows('Interfaces').map(function (r) {
      const props = splitProps(list(r, 'adi').concat(list(r, 'options')));
      const addresses = report.addresses.filter(function (a) { return a.device === text(r, 'name'); });
      return {
        id: toNumber(text(r, 'id')),
        name: text(r, 'name'),
        type: text(r, 'type'),
        flags: list(r, 'flags'),
        zones: list(r, 'zones'),
        state: text(r, 'state'),
        props: props,
        addresses: addresses,
      };
    });

    attachRules(report, rows('Firewall rules'));
    buildLookups(report);
    return report;
  }

  function attachRules(report, ruleRows) {
    const groupsByName = {};
    report.ruleGroups.forEach(function (g) { groupsByName[g.name] = g; });

    ruleRows.forEach(function (r) {
      const flags = list(r, 'flags');
      const groupName = text(r, 'group').replace(AUTO_GENERATED, '').trim();
      const group = groupsByName[groupName];
      const action = ACTIONS.find(function (a) { return flags.indexOf(a) !== -1; }) || '';
      const natType = NAT_TYPES.find(function (n) { return flags.indexOf(n) !== -1; }) || '';
      const rule = {
        pos: toNumber(text(r, 'pos')),
        id: toNumber(text(r, 'id')),
        group: groupName,
        source: text(r, 'src'),
        destination: text(r, 'dst'),
        service: text(r, 'service'),
        natNode: text(r, 'nat_node'),
        natService: text(r, 'nat_service'),
        natType: natType,
        action: action,
        log: flags.filter(function (f) { return /^LOG/.test(f); })[0] || '',
        disabled: flags.indexOf('DISABLED') !== -1,
        flags: flags,
        timeProfile: text(r, 'timeprofile'),
        qos: text(r, 'qos'),
        appLayer: text(r, 'applayer'),
        route: text(r, 'route'),
        comment: text(r, 'comment'),
      };
      rule.enabled = !rule.disabled && (!group || group.enabled);
      if (group) group.rules.push(rule);
    });
    report.ruleGroups.forEach(function (g) {
      g.rules.sort(function (a, b) { return a.pos - b.pos; });
    });
    report.rules = [];
    report.ruleGroups.forEach(function (g) { g.rules.forEach(function (rule) { report.rules.push(rule); }); });
  }

  /* ---------- Name lookups ---------- */

  function indexBy(items) {
    const map = new Map();
    items.forEach(function (item) { map.set(item.name, item); });
    return map;
  }

  function buildLookups(report) {
    const interfacesByName = indexBy(report.interfaces);
    const zonesByName = indexBy(report.zones);
    const nodesByName = indexBy(report.nodes);
    const nodeGroupsByName = indexBy(report.nodeGroups);
    const servicesByName = indexBy(report.services);
    const serviceGroupsByName = indexBy(report.serviceGroups);

    function interfaceAddress(device) {
      const iface = interfacesByName.get(device);
      return iface && iface.addresses.length ? iface.addresses[0].address : '';
    }

    /** Adds `kind` (any/host/network/geoip/interface/interface-network) and the concrete `cidr` to a node. */
    report.nodes.forEach(function (node) {
      const address = node.address;
      if (address === '0.0.0.0/0') {
        node.kind = 'any';
        node.cidr = address;
      } else if (/^GEOIP:/i.test(address)) {
        node.kind = 'geoip';
        node.cidr = '';
      } else if (interfacesByName.has(address)) {
        const firewallSide = /^firewall-/.test(node.zone);
        node.kind = firewallSide ? 'interface' : 'interface-network';
        const cidr = interfaceAddress(address);
        node.cidr = firewallSide ? cidr.replace(/\/\d+$/, '') : networkOf(cidr);
        node.device = address;
      } else if (/\/32$/.test(address) || /^\d+\.\d+\.\d+\.\d+$/.test(address)) {
        node.kind = 'host';
        node.cidr = address;
      } else if (/\//.test(address)) {
        node.kind = 'network';
        node.cidr = address;
      } else {
        node.kind = 'host';
        node.cidr = address;
      }
    });

    /**
     * Resolves a source/destination name to a node or a node group (with its member nodes).
     * @returns {{name: string, type: 'node'|'group'|'unknown', node?: object, group?: object, members: object[]}}
     */
    report.resolveEndpoint = function (name) {
      if (nodesByName.has(name)) return { name: name, type: 'node', node: nodesByName.get(name), members: [nodesByName.get(name)] };
      if (nodeGroupsByName.has(name)) {
        const group = nodeGroupsByName.get(name);
        const members = group.members.map(function (m) { return nodesByName.get(m); }).filter(Boolean);
        return { name: name, type: 'group', group: group, members: members };
      }
      return { name: name, type: 'unknown', members: [] };
    };

    /** Resolves a service name to a service or a service group (with its member services). */
    report.resolveService = function (name) {
      if (servicesByName.has(name)) return { name: name, type: 'service', service: servicesByName.get(name), members: [servicesByName.get(name)] };
      if (serviceGroupsByName.has(name)) {
        const group = serviceGroupsByName.get(name);
        const members = group.members.map(function (m) { return servicesByName.get(m); }).filter(Boolean);
        return { name: name, type: 'group', group: group, members: members };
      }
      return { name: name, type: 'unknown', members: [] };
    };

    report.zoneByName = function (name) { return zonesByName.get(name); };
    report.interfaceByName = function (name) { return interfacesByName.get(name); };
  }

  const api = {
    detect: detect,
    parseReport: parseReport,
    readTables: readTables,
    networkOf: networkOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RouterLens = (root.RouterLens = root.RouterLens || {});
  RouterLens.securepoint = api;
})(typeof window !== 'undefined' ? window : globalThis);
