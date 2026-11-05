/*
 * icom OS config export parser.
 *
 * Input format (one entry per line):
 *   section.subsection.key=value
 *   section.list[1].key=value
 *
 * Multi-line values are wrapped in "-----BEGIN <label>-----" / "-----END <label>-----"
 * markers. Their continuation lines may contain "=" (base64 padding, bird config),
 * so everything up to the matching END marker belongs to the value.
 *
 * Lines ending in ".delete=all" / ".add=N" are import directives for the router,
 * not configuration values. They are collected separately.
 *
 * Runs in the browser (global `RouterLens.insys`) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const KEY_LINE = /^([a-z0-9_]+(?:\[\d+\])?(?:\.[a-z0-9_]+(?:\[\d+\])?)*)=(.*)$/i;
  const BEGIN_MARKER = /^-----BEGIN ([^-]+)-----/;
  const SEGMENT = /^([a-z0-9_]+)(?:\[(\d+)\])?$/i;
  const DIRECTIVE = /\.(delete|add)$/;

  function parseConfig(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    const values = new Map();
    const directives = [];
    const warnings = [];

    let lastKey = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = KEY_LINE.exec(line);

      if (!match) {
        if (line.trim() === '') continue;
        // Unwrapped continuation line: append to the previous value.
        if (lastKey !== null) {
          values.set(lastKey, values.get(lastKey) + '\n' + line);
        } else {
          warnings.push({ line: i + 1, message: 'Line without key before first entry', text: line });
        }
        continue;
      }

      const key = match[1];
      let value = match[2];

      const begin = BEGIN_MARKER.exec(value);
      if (begin) {
        const endMarker = '-----END ' + begin[1] + '-----';
        if (!value.includes(endMarker)) {
          let j = i + 1;
          while (j < lines.length && !lines[j].includes(endMarker)) {
            value += '\n' + lines[j];
            j++;
          }
          if (j < lines.length) {
            value += '\n' + lines[j];
          } else {
            warnings.push({ line: i + 1, message: 'Missing ' + endMarker, text: key });
          }
          i = j;
        }
      }

      if (DIRECTIVE.test(key)) {
        directives.push({ key: key, value: value });
        lastKey = null;
        continue;
      }

      if (values.has(key)) {
        warnings.push({ line: i + 1, message: 'Duplicate key, last value wins', text: key });
      }
      values.set(key, value);
      lastKey = key;
    }

    return new Config(values, directives, warnings);
  }

  /**
   * Strips icom text wrappers like "-----BEGIN device_note-----...-----END device_note-----".
   * Wrappers whose label equals the key name are pure transport encoding; real PEM
   * blocks (label "CERTIFICATE" etc.) are left untouched.
   */
  function unwrapValue(key, value) {
    const begin = BEGIN_MARKER.exec(value);
    if (!begin) return value;
    const label = begin[1];
    const keyName = key.split('.').pop().replace(/\[\d+\]$/, '');
    if (label !== keyName) return value;
    const endMarker = '-----END ' + label + '-----';
    const inner = value.slice(begin[0].length);
    const end = inner.lastIndexOf(endMarker);
    return end === -1 ? inner : inner.slice(0, end).replace(/^\n|\n$/g, '');
  }

  function buildTree(values) {
    const tree = {};
    for (const [key, raw] of values) {
      const segments = key.split('.');
      let node = tree;
      for (let s = 0; s < segments.length; s++) {
        const seg = SEGMENT.exec(segments[s]);
        if (!seg) break;
        const name = seg[1];
        const isLast = s === segments.length - 1;
        const value = isLast ? unwrapValue(key, raw) : undefined;

        if (seg[2] !== undefined) {
          const index = Number(seg[2]) - 1; // config arrays are 1-based
          if (!Array.isArray(node[name])) node[name] = [];
          if (isLast) {
            node[name][index] = value;
          } else {
            if (typeof node[name][index] !== 'object' || node[name][index] === null) node[name][index] = {};
            node = node[name][index];
          }
        } else if (isLast) {
          node[name] = value;
        } else {
          if (typeof node[name] !== 'object' || node[name] === null) node[name] = {};
          node = node[name];
        }
      }
    }
    return tree;
  }

  // icom OS's own default swatch colors for net1..net5, sampled from the classic (pre-ip_nets)
  // web GUI, which always assigned these colors and carried no "color" config field for them.
  const LEGACY_NET_COLORS = ['#FFDB42', '#7FC400', '#FF9EAF', '#7FD2ED', '#E86E31'];

  function randomNetColor() {
    return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
  }

  /**
   * Older icom OS exports (pre ip_nets, e.g. icom OS 7.2) place the 5 fixed IP networks
   * directly under interfaces.netN instead of interfaces.ip_nets.net[N], and their DHCP
   * servers link to a net by array position instead of an explicit "interface" field.
   * Normalize both into the current schema so the rest of the app only deals with one shape.
   */
  function normalizeLegacySchema(tree) {
    const ifaces = tree.interfaces;
    if (ifaces && !ifaces.ip_nets) {
      const numbers = Object.keys(ifaces)
        .map(function (k) { return SEGMENT.exec(k) && /^net\d+$/i.test(k) ? Number(k.slice(3)) : null; })
        .filter(function (n) { return n !== null; });
      if (numbers.length) {
        const list = [];
        numbers.forEach(function (n) {
          const net = Object.assign({ name: 'net' + n }, ifaces['net' + n]);
          if (net.color === undefined) net.color = LEGACY_NET_COLORS[n - 1] || randomNetColor();
          list[n - 1] = net;
        });
        ifaces.ip_nets = { net: list };
      }
    }

    const servers = tree.services && tree.services.dhcp_server && tree.services.dhcp_server.server;
    if (Array.isArray(servers) && servers.some(Boolean) &&
      servers.every(function (s) { return !s || s.interface === undefined; })) {
      servers.forEach(function (s, i) { if (s) s.interface = 'net' + (i + 1); });
    }
  }

  class Config {
    constructor(values, directives, warnings) {
      this.values = values;
      this.directives = directives;
      this.warnings = warnings;
      this.tree = buildTree(values);
      normalizeLegacySchema(this.tree);
    }

    has(key) {
      return this.values.has(key);
    }

    /** Raw value for a flat key, with icom text wrappers removed. */
    get(key) {
      return this.values.has(key) ? unwrapValue(key, this.values.get(key)) : undefined;
    }

    /** Subtree for a dotted path, e.g. "interfaces.ip_nets". */
    node(path) {
      let node = this.tree;
      for (const part of path.split('.')) {
        if (node == null) return undefined;
        node = node[part];
      }
      return node;
    }

    /** Array at path with holes removed, each item annotated with its 1-based index. */
    list(path) {
      const arr = this.node(path);
      if (!Array.isArray(arr)) return [];
      const out = [];
      arr.forEach(function (item, i) {
        if (item && typeof item === 'object') out.push(Object.assign({ _index: i + 1 }, item));
      });
      return out;
    }
  }

  const api = { parseConfig: parseConfig, unwrapValue: unwrapValue };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.RouterLens = root.RouterLens || {};
    root.RouterLens.insys = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
