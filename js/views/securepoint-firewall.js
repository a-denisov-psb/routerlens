/*
 * Securepoint firewall: tab bar (Rules, plus further tabs registered by other scripts via
 * RouterLens.securepointFirewall.registerTab) and the packet filter rules tab.
 *
 * Rules tab: rules grouped like in the Securepoint GUI (collapsible group rows with their
 * active state), per-column filters, a global search over everything a rule resolves to, and
 * a detail panel per rule that expands the source, destination and service names down to the
 * network objects / services of their groups.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const spui = RouterLens.spui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3l7 3.5v5c0 4.6-3 8.6-7 9.5-4-.9-7-4.9-7-9.5v-5z"/><path d="m9 12 2 2 4-4"/></svg>';

  /* ---------- Tabs ---------- */

  const tabs = [];

  RouterLens.securepointFirewall = {
    /** @param {{id: string, label: string, render: function(object): Node}} tab */
    registerTab: function (tab) { tabs.push(tab); },
  };

  function render(report, ctx) {
    const active = tabs.find(function (t) { return t.id === ctx.sub; }) || tabs[0];
    const bar = tabs.length > 1
      ? h('nav', { class: 'subtabs', 'aria-label': 'Firewall sections' }, tabs.map(function (t) {
        return h('a', { class: 'subtab' + (t === active ? ' active' : ''), href: '#firewall/' + t.id }, t.label);
      }))
      : null;
    return h('div', { class: 'firewall' }, bar, active.render(report));
  }

  /* ---------- Labels ---------- */

  const ACTION_LABEL = { ACCEPT: 'Accept', DROP: 'Drop', REJECT: 'Reject' };
  const NAT_LABEL = { HIDENAT: 'Hide NAT', DNAT: 'DNAT', SNAT: 'SNAT', NETMAP: 'NetMap' };
  const NAT_HINT = {
    HIDENAT: 'Hides the original source address behind the address of the NAT object.',
  };
  const LOG_LABEL = { LOG_ALL: 'Long', LOG_SHORT: 'Short' };

  function actionBadge(action) {
    if (!action) return spui.dash();
    return h('span', { class: 'badge badge-action-' + action.toLowerCase() }, ACTION_LABEL[action] || action);
  }

  function logLabel(log) {
    return log ? (LOG_LABEL[log] || log) : '';
  }

  /* ---------- Resolved rule ---------- */

  function resolveRule(report, rule) {
    return {
      rule: rule,
      source: report.resolveEndpoint(rule.source),
      destination: report.resolveEndpoint(rule.destination),
      service: report.resolveService(rule.service),
      natNode: rule.natNode ? report.resolveEndpoint(rule.natNode) : null,
      natService: rule.natService ? report.resolveService(rule.natService) : null,
    };
  }

  function endpointText(resolved) {
    return [resolved.name].concat(resolved.members.map(function (n) {
      return [n.name, n.address, n.cidr, n.zone, spui.KIND_LABEL[n.kind]].join(' ');
    })).join(' ');
  }

  function serviceText(resolved) {
    return [resolved.name].concat(resolved.members.map(function (s) {
      return [s.name, s.protocol, s.ports.join(' '), s.icmpTypes.join(' '), s.sourcePorts.join(' ')].join(' ');
    })).join(' ');
  }

  /** Lower-cased text of everything the rule shows or resolves to, for the global search. */
  function searchText(entry) {
    const r = entry.rule;
    return [
      r.pos, r.id, r.group, r.source, r.destination, r.service, r.natNode, r.natService, r.natType, r.action,
      logLabel(r.log), r.flags.join(' '), r.timeProfile, r.qos, r.appLayer, r.route, r.comment,
      r.enabled ? 'active' : 'inactive',
      endpointText(entry.source), endpointText(entry.destination), serviceText(entry.service),
      entry.natNode ? endpointText(entry.natNode) : '', entry.natService ? serviceText(entry.natService) : '',
    ].join(' ').toLowerCase();
  }

  /* ---------- Cells ---------- */

  function chipList(chips) {
    return h('div', { class: 'chip-list' }, chips);
  }

  function natCell(entry) {
    const r = entry.rule;
    if (!r.natType) return spui.dash();
    return h('div', { class: 'nat-cell' },
      h('span', { class: 'badge badge-nat' }, NAT_LABEL[r.natType] || r.natType),
      entry.natNode ? spui.endpointChip(entry.natNode) : null,
      entry.natService ? spui.serviceChip(entry.natService) : null);
  }

  function activeCell(rule, group) {
    const pill = h('span', { class: 'pill ' + (rule.enabled ? 'pill-on' : 'pill-off') }, rule.enabled ? 'Active' : 'Inactive');
    if (!rule.enabled && group && !group.enabled && !rule.disabled) pill.title = 'Disabled by its rule group';
    return pill;
  }

  /* ---------- Detail panel ---------- */

  function nodeTable(resolved) {
    if (resolved.type === 'unknown') return ui.emptyNote('"' + resolved.name + '" is not defined in this report.');
    const rows = resolved.members.map(function (n) {
      return h('tr', null,
        h('td', null, spui.endpointChip({ type: 'node', name: n.name, node: n })),
        h('td', { class: 'muted' }, spui.KIND_LABEL[n.kind] || n.kind),
        h('td', null, h('code', null, spui.nodeAddress(n))),
        h('td', null, n.zone ? spui.zoneChip(n.zone) : spui.dash()));
    });
    return h('table', { class: 'table table-resolved' },
      h('thead', null, h('tr', null, h('th', null, 'Object'), h('th', null, 'Type'), h('th', null, 'Address'), h('th', null, 'Zone'))),
      h('tbody', null, rows));
  }

  function serviceTable(resolved) {
    if (resolved.type === 'unknown') return ui.emptyNote('"' + resolved.name + '" is not defined in this report.');
    const rows = resolved.members.map(function (s) {
      return h('tr', null,
        h('td', null, spui.serviceChip({ type: 'service', name: s.name, service: s })),
        h('td', null, ui.protocolBadge(protocolKey(s.protocol))),
        h('td', null, s.ports.length ? h('code', null, s.ports.join(', ')) : spui.dash()),
        h('td', null, s.icmpTypes.length ? h('code', null, s.icmpTypes.join(', ')) : spui.dash()),
        h('td', null, s.sourcePorts.length ? h('code', null, s.sourcePorts.join(', ')) : spui.dash()));
    });
    return h('table', { class: 'table table-resolved' },
      h('thead', null, h('tr', null, h('th', null, 'Service'), h('th', null, 'Protocol'), h('th', null, 'Ports'), h('th', null, 'ICMP types'), h('th', null, 'Source ports'))),
      h('tbody', null, rows));
  }

  /** Maps Securepoint protocol names to the keys ui.protocolBadge knows. */
  function protocolKey(protocol) {
    if (protocol === 'ipv6-icmp') return 'icmpv6';
    if (protocol === 'any') return 'all';
    return protocol || '';
  }

  function resolvedBlock(title, resolved, tableFn) {
    const head = h('div', { class: 'resolved-head' },
      resolved.type === 'group' ? spui.kindIcon('group') : null,
      h('strong', null, resolved.name),
      resolved.type === 'group' ? h('span', { class: 'muted' }, 'group · ' + resolved.members.length + (resolved.members.length === 1 ? ' member' : ' members')) : null);
    return h('div', { class: 'detail-group' },
      h('h4', { class: 'detail-group-title' }, title), head, h('div', { class: 'table-wrap table-wrap-flush' }, tableFn(resolved)));
  }

  function detailPanel(entry, group) {
    const r = entry.rule;
    const blocks = [
      ui.detailGroup('Rule', [
        ['Status', activeCell(r, group)],
        ['Action', actionBadge(r.action)],
        ['Group', group ? group.name + (group.enabled ? '' : ' (disabled)') : r.group],
        ['Position', r.pos === null ? undefined : String(r.pos)],
        ['Rule ID', r.id === null ? undefined : String(r.id)],
        ['Logging', logLabel(r.log) || ''],
        ['Comment', r.comment || ''],
      ]),
      resolvedBlock('Source', entry.source, nodeTable),
      resolvedBlock('Destination', entry.destination, nodeTable),
      resolvedBlock('Service', entry.service, serviceTable),
    ];
    if (r.natType) {
      const nat = [
        ui.detailGroup('NAT', [
          ['Type', h('span', { class: 'badge badge-nat' }, NAT_LABEL[r.natType] || r.natType)],
          ['Meaning', NAT_HINT[r.natType]],
        ]),
      ];
      if (entry.natNode) nat.push(resolvedBlock('NAT object', entry.natNode, nodeTable));
      if (entry.natService) nat.push(resolvedBlock('NAT service', entry.natService, serviceTable));
      blocks.push(h('div', { class: 'detail-section' }, nat));
    }
    const extra = ui.detailGroup('Extras', [
      ['Time profile', r.timeProfile],
      ['QoS', r.qos],
      ['Application layer', r.appLayer],
      ['Route', r.route],
    ]);
    if (extra) blocks.push(extra);
    return h('div', { class: 'detail-panel detail-panel-wide' }, blocks.filter(Boolean));
  }

  /* ---------- Rules tab ---------- */

  const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>';

  function filterSelect(label, options) {
    return h('select', { class: 'rule-filter', 'aria-label': label },
      h('option', { value: '' }, 'All'),
      options.map(function (o) { return h('option', { value: o.value }, o.label); }));
  }

  function filterInput(label) {
    return h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': label });
  }

  function distinct(list) {
    return Array.from(new Set(list.filter(Boolean))).sort();
  }

  function rulesTab(report) {
    if (!report.ruleGroups.length) {
      return ui.card({ title: 'Packet filter rules', body: ui.emptyNote('No firewall rules in this report.') });
    }

    const search = h('input', { type: 'search', class: 'rule-search', placeholder: 'Search all rule fields, objects and services…', 'aria-label': 'Search all rule fields' });
    const resultCount = h('span', { class: 'rule-count' });

    const activeFilter = filterSelect('Filter by active state', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]);
    const sourceFilter = filterInput('Filter by source');
    const destinationFilter = filterInput('Filter by destination');
    const serviceFilter = filterInput('Filter by service');
    const natFilter = filterSelect('Filter by NAT', [{ value: 'none', label: 'No NAT' }].concat(
      distinct(report.rules.map(function (r) { return r.natType; })).map(function (v) { return { value: v, label: NAT_LABEL[v] || v }; })));
    const logFilter = filterSelect('Filter by logging', [{ value: 'none', label: 'No logging' }].concat(
      distinct(report.rules.map(function (r) { return r.log; })).map(function (v) { return { value: v, label: logLabel(v) }; })));
    const actionFilter = filterSelect('Filter by action',
      distinct(report.rules.map(function (r) { return r.action; })).map(function (v) { return { value: v, label: ACTION_LABEL[v] || v }; }));

    const groupEntries = report.ruleGroups.map(function (group) {
      const entries = group.rules.map(function (rule) {
        const resolved = resolveRule(report, rule);
        const detail = h('tr', { class: 'row-detail', hidden: true }, h('td', { colspan: '8' }, detailPanel(resolved, group)));
        const tr = h('tr', { class: 'rule-row' + (rule.enabled ? '' : ' row-inactive'), tabindex: '0', role: 'button', 'aria-expanded': 'false' },
          h('td', { class: 'muted' }, String(rule.pos)),
          h('td', null, activeCell(rule, group)),
          h('td', null, chipList(spui.endpointChip(resolved.source))),
          h('td', null, chipList(spui.endpointChip(resolved.destination))),
          h('td', null, chipList(spui.serviceChip(resolved.service))),
          h('td', null, natCell(resolved)),
          h('td', null, logLabel(rule.log) || h('span', { class: 'muted' }, ui.EMPTY)),
          h('td', null, actionBadge(rule.action)));

        function toggle() {
          const willOpen = detail.hidden;
          detail.hidden = !willOpen;
          tr.classList.toggle('open', willOpen);
          tr.setAttribute('aria-expanded', String(willOpen));
        }
        tr.addEventListener('click', toggle);
        tr.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggle();
        });

        return {
          rule: rule,
          resolved: resolved,
          searchText: searchText(resolved),
          sourceText: endpointText(resolved.source).toLowerCase(),
          destinationText: endpointText(resolved.destination).toLowerCase(),
          serviceText: serviceText(resolved.service).toLowerCase(),
          tr: tr,
          detail: detail,
        };
      });

      const count = h('span', { class: 'group-count' });
      const headRow = h('tr', { class: 'group-row' + (group.enabled ? '' : ' row-inactive'), tabindex: '0', role: 'button', 'aria-expanded': 'true' },
        h('td', { colspan: '8' },
          h('div', { class: 'group-head' },
            h('span', { class: 'group-chevron', html: CHEVRON, 'aria-hidden': 'true' }),
            spui.kindIcon('group'),
            h('strong', { class: 'group-name' }, group.name),
            group.autoGenerated ? h('span', { class: 'badge badge-auto' }, 'auto-generated') : null,
            h('span', { class: 'pill ' + (group.enabled ? 'pill-on' : 'pill-off') }, group.enabled ? 'Active' : 'Inactive'),
            count)));

      const state = { group: group, entries: entries, headRow: headRow, count: count, collapsed: false };
      function toggleGroup() {
        state.collapsed = !state.collapsed;
        headRow.classList.toggle('collapsed', state.collapsed);
        headRow.setAttribute('aria-expanded', String(!state.collapsed));
        applyFilters();
      }
      headRow.addEventListener('click', toggleGroup);
      headRow.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleGroup();
      });
      return state;
    });

    function matches(entry, f) {
      const r = entry.rule;
      return (!f.q || entry.searchText.indexOf(f.q) !== -1) &&
        (!f.active || r.enabled === (f.active === '1')) &&
        (!f.source || entry.sourceText.indexOf(f.source) !== -1) &&
        (!f.destination || entry.destinationText.indexOf(f.destination) !== -1) &&
        (!f.service || entry.serviceText.indexOf(f.service) !== -1) &&
        (!f.nat || (f.nat === 'none' ? !r.natType : r.natType === f.nat)) &&
        (!f.log || (f.log === 'none' ? !r.log : r.log === f.log)) &&
        (!f.action || r.action === f.action);
    }

    function applyFilters() {
      const f = {
        q: search.value.trim().toLowerCase(),
        active: activeFilter.value,
        source: sourceFilter.value.trim().toLowerCase(),
        destination: destinationFilter.value.trim().toLowerCase(),
        service: serviceFilter.value.trim().toLowerCase(),
        nat: natFilter.value,
        log: logFilter.value,
        action: actionFilter.value,
      };
      const filtering = Object.keys(f).some(function (k) { return f[k]; });
      let visible = 0;
      let total = 0;
      groupEntries.forEach(function (g) {
        let shown = 0;
        g.entries.forEach(function (entry) {
          total++;
          const ok = matches(entry, f);
          if (ok) shown++;
          const hide = !ok || g.collapsed;
          entry.tr.hidden = hide;
          if (hide) {
            entry.detail.hidden = true;
            entry.tr.classList.remove('open');
            entry.tr.setAttribute('aria-expanded', 'false');
          }
        });
        visible += shown;
        g.headRow.hidden = filtering && shown === 0;
        g.count.textContent = (filtering ? shown + ' / ' : '') + g.entries.length + (g.entries.length === 1 ? ' rule' : ' rules');
      });
      resultCount.textContent = visible === total ? total + ' rules' : visible + ' / ' + total + ' rules';
    }

    [search, activeFilter, sourceFilter, destinationFilter, serviceFilter, natFilter, logFilter, actionFilter].forEach(function (el) {
      el.addEventListener('input', applyFilters);
      el.addEventListener('change', applyFilters);
    });

    const tbody = h('tbody', null, groupEntries.map(function (g) {
      return [g.headRow, g.entries.map(function (entry) { return [entry.tr, entry.detail]; })];
    }));

    const table = h('table', { class: 'table table-expand table-rules' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Pos.'), h('th', null, 'Active'), h('th', null, 'Source'), h('th', null, 'Destination'),
          h('th', null, 'Service'), h('th', null, 'NAT'), h('th', null, 'Logging'), h('th', null, 'Action')),
        h('tr', { class: 'rule-filter-row' },
          h('th', null), h('th', null, activeFilter), h('th', null, sourceFilter), h('th', null, destinationFilter),
          h('th', null, serviceFilter), h('th', null, natFilter), h('th', null, logFilter), h('th', null, actionFilter))),
      tbody);

    applyFilters();

    return ui.card({
      title: 'Packet filter rules',
      className: 'card-firewall',
      body: [
        h('div', { class: 'rule-toolbar' }, search, resultCount),
        h('div', { class: 'table-wrap' }, table),
      ],
    });
  }

  RouterLens.securepointFirewall.registerTab({ id: 'rules', label: 'Rules', render: rulesTab });
  RouterLens.views.register({ id: 'firewall', label: 'Firewall', icon: ICON, device: 'securepoint', render: render });
})(window);
