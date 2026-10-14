/*
 * Securepoint firewall tabs "Network objects" and "Services": the groups (with their members)
 * next to the single objects / services, laid out like the Securepoint GUI. Every entry shows
 * where it is used (rules, directly or through a group) and which groups contain it.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const spui = RouterLens.spui;
  const h = ui.h;

  const MEMBER_LIMIT = 8;

  /* ---------- Shared building blocks ---------- */

  /** Chips with a "more" toggle so groups with dozens of members stay compact. */
  function memberChips(chips) {
    if (chips.length <= MEMBER_LIMIT) return h('div', { class: 'chip-list' }, chips);
    const rest = chips.slice(MEMBER_LIMIT);
    const wrap = h('div', { class: 'chip-list' }, chips.slice(0, MEMBER_LIMIT));
    const extra = h('span', { class: 'chip-more', hidden: true }, rest);
    const toggle = h('button', { class: 'link-btn', type: 'button' }, '+' + rest.length + ' more');
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      extra.hidden = !extra.hidden;
      toggle.textContent = extra.hidden ? '+' + rest.length + ' more' : 'Show less';
    });
    wrap.appendChild(extra);
    wrap.appendChild(toggle);
    return wrap;
  }

  function ruleLabel(rule) {
    return rule.group + ' #' + rule.pos;
  }

  /** "3 rules" with the rule list as tooltip; a dash when unused. */
  function usageCell(rules) {
    if (!rules.length) return h('span', { class: 'muted', title: 'Not used in any rule' }, ui.EMPTY);
    return h('span', { class: 'usage', title: rules.map(ruleLabel).join('\n') }, String(rules.length));
  }

  function groupsCell(groups) {
    if (!groups.length) return h('span', { class: 'muted' }, ui.EMPTY);
    return h('div', { class: 'chip-list' }, groups.map(function (g) {
      return h('span', { class: 'chip chip-object', style: { '--chip': 'var(--primary)' } }, spui.kindIcon('group'), g.name);
    }));
  }

  /**
   * Card with a search box and a table. Items: { key, cells: Node[], text: string, tag?: string }.
   * Rows are selectable (master-detail): `onSelect(key)` is called on click and `setLink` lets
   * the other side restrict this list to related entries; the search box keeps working on top.
   * Toggles hide items with a given tag until their checkbox is ticked (ignored while linked).
   */
  function listCard(opts) {
    const search = h('input', { type: 'search', class: 'rule-search', placeholder: opts.placeholder, 'aria-label': opts.placeholder });
    const count = h('span', { class: 'rule-count' });
    const note = h('span', { class: 'link-note', hidden: true });
    const noteText = h('span');
    const noteClear = h('button', { class: 'link-note-clear', type: 'button', 'aria-label': 'Clear selection', title: 'Clear selection' }, '×');
    note.appendChild(noteText);
    note.appendChild(noteClear);
    const toggles = (opts.toggles || []).map(function (t) {
      const box = h('input', { type: 'checkbox' });
      return { tag: t.tag, box: box, el: h('label', { class: 'check' }, box, ' ' + t.label) };
    });

    const rows = opts.items.map(function (item) {
      const tr = h('tr', { class: 'row-select', tabindex: '0', 'aria-selected': 'false' },
        item.cells.map(function (c) { return h('td', null, c); }));
      const row = { item: item, text: item.text.toLowerCase(), tr: tr };
      function pick() { if (opts.onSelect) opts.onSelect(item.key); }
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        pick();
      });
      return row;
    });

    let linkKeys = null; // Set of item keys allowed by the other side's selection, or null

    function apply() {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      let total = 0;
      rows.forEach(function (row) {
        const toggle = toggles.find(function (t) { return t.tag === row.item.tag; });
        const inScope = linkKeys ? linkKeys.has(row.item.key) : (!toggle || toggle.box.checked);
        if (inScope) total++;
        const ok = inScope && (!q || row.text.indexOf(q) !== -1);
        row.tr.hidden = !ok;
        if (ok) visible++;
      });
      count.textContent = visible === total ? total + ' ' + opts.noun : visible + ' / ' + total + ' ' + opts.noun;
    }

    search.addEventListener('input', apply);
    toggles.forEach(function (t) { t.box.addEventListener('change', apply); });
    noteClear.addEventListener('click', function (e) {
      e.stopPropagation();
      if (opts.onClear) opts.onClear();
    });
    apply();

    const table = h('table', { class: 'table table-list' },
      h('thead', null, h('tr', null, opts.headers.map(function (title) { return h('th', null, title); }))),
      h('tbody', null, rows.map(function (r) { return r.tr; })));

    const noteRow = h('div', { class: 'link-note-row', hidden: true }, note);

    const card = ui.card({
      title: opts.title,
      className: 'card-list',
      body: [
        h('div', { class: 'rule-toolbar' }, search, count, toggles.map(function (t) { return t.el; })),
        noteRow,
        rows.length ? h('div', { class: 'table-wrap' }, table) : ui.emptyNote(opts.empty),
      ],
    });

    return {
      card: card,
      /** Highlights the selected row (or none). */
      markSelected: function (key) {
        rows.forEach(function (row) {
          const on = key !== null && row.item.key === key;
          row.tr.classList.toggle('selected', on);
          row.tr.setAttribute('aria-selected', String(on));
        });
      },
      /** Restricts the list to the given keys (null lifts the restriction); `text` explains why. */
      setLink: function (keys, text) {
        linkKeys = keys;
        note.hidden = !keys;
        noteRow.hidden = !keys;
        noteText.textContent = text || '';
        apply();
      },
    };
  }

  /**
   * Master-detail behaviour for a groups list (left) and an objects list (right): selecting a
   * group shows only its members on the right, selecting an object shows only the groups that
   * contain it on the left. Clicking the selected row again, the "×" in the note, Escape or the
   * empty background clears the selection.
   * @param {function(function, function): object} makeLeft Builds the groups list card.
   * @param {function(function, function): object} makeRight Builds the objects list card.
   * @param {function(string): string[]} membersOf Member keys of a group.
   * @param {function(string): string[]} groupsOf Keys of the groups containing an object.
   * @param {{members: string, groups: string}} labels Note texts for the filtered side.
   * @returns {Node}
   */
  function masterDetail(makeLeft, makeRight, membersOf, groupsOf, labels) {
    let selected = null; // { side: 'group'|'item', key }

    function show() {
      left.markSelected(selected && selected.side === 'group' ? selected.key : null);
      right.markSelected(selected && selected.side === 'item' ? selected.key : null);
      if (!selected) {
        left.setLink(null);
        right.setLink(null);
      } else if (selected.side === 'group') {
        left.setLink(null);
        right.setLink(new Set(membersOf(selected.key)), labels.members + ' "' + selected.key + '"');
      } else {
        right.setLink(null);
        left.setLink(new Set(groupsOf(selected.key)), labels.groups + ' "' + selected.key + '"');
      }
    }

    function choose(side, key) {
      selected = selected && selected.side === side && selected.key === key ? null : { side: side, key: key };
      show();
    }

    function clear() {
      if (!selected) return;
      selected = null;
      show();
    }

    const left = makeLeft(function (key) { choose('group', key); }, clear);
    const right = makeRight(function (key) { choose('item', key); }, clear);
    const grid = h('div', { class: 'object-grid' }, left.card, right.card);

    // A click on the empty background deselects; rows and form controls keep their own behaviour.
    function onDocumentClick(e) {
      if (!grid.isConnected) { detach(); return; }
      if (e.target.closest && e.target.closest('tr.row-select, input, select, button, label, a')) return;
      clear();
    }
    function onKey(e) {
      if (!grid.isConnected) { detach(); return; }
      if (e.key === 'Escape') clear();
    }
    function detach() {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKey);
    }
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKey);
    return grid;
  }

  /* ---------- Network objects ---------- */

  function nodeItem(report, node) {
    const usage = report.rulesUsingObject(node.name);
    const groups = report.groupsOfObject(node.name);
    return {
      key: node.name,
      tag: node.kind === 'geoip' ? 'geoip' : '',
      text: [node.name, node.address, node.cidr, node.zone, spui.KIND_LABEL[node.kind], groups.map(function (g) { return g.name; }).join(' ')].join(' '),
      cells: [
        spui.endpointChip({ type: 'node', name: node.name, node: node }),
        h('span', { class: 'muted' }, spui.KIND_LABEL[node.kind] || node.kind),
        h('code', null, spui.nodeAddress(node)),
        node.zone ? spui.zoneChip(node.zone) : spui.dash(),
        groupsCell(groups),
        usageCell(usage),
      ],
    };
  }

  function nodeGroupItem(report, group) {
    const resolved = report.resolveEndpoint(group.name);
    return {
      key: group.name,
      text: [group.name].concat(resolved.members.map(function (n) { return n.name + ' ' + n.address + ' ' + n.cidr; })).join(' '),
      cells: [
        h('strong', null, group.name),
        memberChips(resolved.members.map(function (n) { return spui.endpointChip({ type: 'node', name: n.name, node: n }); })),
        usageCell(report.rulesUsingObject(group.name)),
      ],
    };
  }

  function objectsTab(report) {
    const geoip = report.nodes.filter(function (n) { return n.kind === 'geoip'; }).length;
    const groupMembers = {};
    report.nodeGroups.forEach(function (g) { groupMembers[g.name] = g.members; });
    return masterDetail(
      function (onSelect, onClear) {
        return listCard({
          title: 'Network groups',
          placeholder: 'Search groups and members…',
          noun: 'groups',
          empty: 'No network groups in this report.',
          headers: ['Name', 'Objects', 'Rules'],
          items: report.nodeGroups.map(function (g) { return nodeGroupItem(report, g); }),
          onSelect: onSelect,
          onClear: onClear,
        });
      },
      function (onSelect, onClear) {
        return listCard({
          title: 'Network objects',
          placeholder: 'Search name, address or zone…',
          noun: 'objects',
          empty: 'No network objects in this report.',
          headers: ['Name', 'Type', 'Address', 'Zone', 'In groups', 'Rules'],
          toggles: geoip ? [{ tag: 'geoip', label: 'Show GeoIP countries (' + geoip + ')' }] : [],
          items: report.nodes.map(function (n) { return nodeItem(report, n); }),
          onSelect: onSelect,
          onClear: onClear,
        });
      },
      function (group) { return groupMembers[group] || []; },
      function (name) { return report.groupsOfObject(name).map(function (g) { return g.name; }); },
      { members: 'Members of', groups: 'Groups containing' });
  }

  /* ---------- Services ---------- */

  function serviceItem(report, svc) {
    const groups = report.groupsOfService(svc.name);
    return {
      key: svc.name,
      text: [svc.name, svc.protocol, svc.helper, svc.ports.join(' '), svc.icmpTypes.join(' '), svc.sourcePorts.join(' '),
        groups.map(function (g) { return g.name; }).join(' ')].join(' '),
      cells: [
        spui.serviceChip({ type: 'service', name: svc.name, service: svc }),
        ui.protocolBadge(protocolKey(svc.protocol)),
        svc.ports.length ? h('code', null, svc.ports.join(', ')) : spui.dash(),
        svc.icmpTypes.length ? h('code', null, svc.icmpTypes.join(', ')) : spui.dash(),
        svc.sourcePorts.length ? h('code', null, svc.sourcePorts.join(', ')) : spui.dash(),
        groups.length ? groupsCell(groups) : spui.dash(),
        usageCell(report.rulesUsingService(svc.name)),
      ],
    };
  }

  function serviceGroupItem(report, group) {
    const resolved = report.resolveService(group.name);
    return {
      key: group.name,
      text: [group.name, group.description].concat(resolved.members.map(function (s) { return s.name + ' ' + s.protocol + ' ' + s.ports.join(' '); })).join(' '),
      cells: [
        h('strong', null, group.name),
        memberChips(resolved.members.map(function (s) { return spui.serviceChip({ type: 'service', name: s.name, service: s }); })),
        usageCell(report.rulesUsingService(group.name)),
      ],
    };
  }

  function protocolKey(protocol) {
    if (protocol === 'ipv6-icmp') return 'icmpv6';
    if (protocol === 'any') return 'all';
    return protocol || '';
  }

  function servicesTab(report) {
    const groupMembers = {};
    report.serviceGroups.forEach(function (g) { groupMembers[g.name] = g.members; });
    return masterDetail(
      function (onSelect, onClear) {
        return listCard({
          title: 'Service groups',
          placeholder: 'Search groups and members…',
          noun: 'groups',
          empty: 'No service groups in this report.',
          headers: ['Name', 'Services', 'Rules'],
          items: report.serviceGroups.map(function (g) { return serviceGroupItem(report, g); }),
          onSelect: onSelect,
          onClear: onClear,
        });
      },
      function (onSelect, onClear) {
        return listCard({
          title: 'Services',
          placeholder: 'Search name, protocol or port…',
          noun: 'services',
          empty: 'No services in this report.',
          headers: ['Name', 'Protocol', 'Ports', 'ICMP types', 'Source ports', 'In groups', 'Rules'],
          items: report.services.map(function (s) { return serviceItem(report, s); }),
          onSelect: onSelect,
          onClear: onClear,
        });
      },
      function (group) { return groupMembers[group] || []; },
      function (name) { return report.groupsOfService(name).map(function (g) { return g.name; }); },
      { members: 'Members of', groups: 'Groups containing' });
  }

  RouterLens.securepointFirewall.registerTab({ id: 'objects', label: 'Network objects', render: objectsTab });
  RouterLens.securepointFirewall.registerTab({ id: 'services', label: 'Services', render: servicesTab });
})(window);
