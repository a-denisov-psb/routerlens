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
   * Card with a search box and a table. Items: { cells: Node[], text: string, tag?: string }.
   * `hiddenTags` lists item tags that are only shown when their checkbox is ticked.
   */
  function listCard(opts) {
    const search = h('input', { type: 'search', class: 'rule-search', placeholder: opts.placeholder, 'aria-label': opts.placeholder });
    const count = h('span', { class: 'rule-count' });
    const toggles = (opts.toggles || []).map(function (t) {
      const box = h('input', { type: 'checkbox' });
      return { tag: t.tag, box: box, el: h('label', { class: 'check' }, box, ' ' + t.label) };
    });

    const rows = opts.items.map(function (item) {
      return { item: item, text: item.text.toLowerCase(), tr: h('tr', null, item.cells.map(function (c) { return h('td', null, c); })) };
    });

    function apply() {
      const q = search.value.trim().toLowerCase();
      let visible = 0;
      rows.forEach(function (row) {
        const toggle = toggles.find(function (t) { return t.tag === row.item.tag; });
        const ok = (!toggle || toggle.box.checked) && (!q || row.text.indexOf(q) !== -1);
        row.tr.hidden = !ok;
        if (ok) visible++;
      });
      const total = rows.filter(function (r) {
        const toggle = toggles.find(function (t) { return t.tag === r.item.tag; });
        return !toggle || toggle.box.checked;
      }).length;
      count.textContent = visible === total ? total + ' ' + opts.noun : visible + ' / ' + total + ' ' + opts.noun;
    }

    search.addEventListener('input', apply);
    toggles.forEach(function (t) { t.box.addEventListener('change', apply); });
    apply();

    const table = h('table', { class: 'table table-list' },
      h('thead', null, h('tr', null, opts.headers.map(function (title) { return h('th', null, title); }))),
      h('tbody', null, rows.map(function (r) { return r.tr; })));

    return ui.card({
      title: opts.title,
      className: 'card-list',
      body: [
        h('div', { class: 'rule-toolbar' }, search, count, toggles.map(function (t) { return t.el; })),
        rows.length ? h('div', { class: 'table-wrap' }, table) : ui.emptyNote(opts.empty),
      ],
    });
  }

  /* ---------- Network objects ---------- */

  function nodeItem(report, node) {
    const usage = report.rulesUsingObject(node.name);
    const groups = report.groupsOfObject(node.name);
    return {
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
    const groups = listCard({
      title: 'Network groups',
      placeholder: 'Search groups and members…',
      noun: 'groups',
      empty: 'No network groups in this report.',
      headers: ['Name', 'Objects', 'Rules'],
      items: report.nodeGroups.map(function (g) { return nodeGroupItem(report, g); }),
    });
    const objects = listCard({
      title: 'Network objects',
      placeholder: 'Search name, address or zone…',
      noun: 'objects',
      empty: 'No network objects in this report.',
      headers: ['Name', 'Type', 'Address', 'Zone', 'In groups', 'Rules'],
      toggles: geoip ? [{ tag: 'geoip', label: 'Show GeoIP countries (' + geoip + ')' }] : [],
      items: report.nodes.map(function (n) { return nodeItem(report, n); }),
    });
    return h('div', { class: 'object-grid' }, groups, objects);
  }

  /* ---------- Services ---------- */

  function serviceItem(report, svc) {
    const groups = report.groupsOfService(svc.name);
    return {
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
    const groups = listCard({
      title: 'Service groups',
      placeholder: 'Search groups and members…',
      noun: 'groups',
      empty: 'No service groups in this report.',
      headers: ['Name', 'Services', 'Rules'],
      items: report.serviceGroups.map(function (g) { return serviceGroupItem(report, g); }),
    });
    const services = listCard({
      title: 'Services',
      placeholder: 'Search name, protocol or port…',
      noun: 'services',
      empty: 'No services in this report.',
      headers: ['Name', 'Protocol', 'Ports', 'ICMP types', 'Source ports', 'In groups', 'Rules'],
      items: report.services.map(function (s) { return serviceItem(report, s); }),
    });
    return h('div', { class: 'object-grid' }, groups, services);
  }

  RouterLens.securepointFirewall.registerTab({ id: 'objects', label: 'Network objects', render: objectsTab });
  RouterLens.securepointFirewall.registerTab({ id: 'services', label: 'Services', render: servicesTab });
})(window);
