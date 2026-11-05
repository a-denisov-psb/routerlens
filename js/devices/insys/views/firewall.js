/*
 * Firewall: table of all netfilter.ip_filter rules with type icons, protocol badges,
 * per-column filters, a global full-text search (incl. fields not shown as columns) and
 * a per-row detail panel listing every field of the rule. Source NAT and Destination NAT
 * rule tables (netfilter.nat.snat / netfilter.nat.dnat) follow below, same interaction.
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3l7 3.5v5c0 4.6-3 8.6-7 9.5-4-.9-7-4.9-7-9.5v-5z"/><path d="m9 12 2 2 4-4"/></svg>';

  /* ---------- Type icons (input / output / forward) ---------- */

  const DIRECTION_LABEL = { input: 'Input', output: 'Output', forward: 'Forward' };

  const DIRECTION_ICON = {
    input: '<path d="M1 8h8"/><path d="m6 4 4 4-4 4"/><path d="M13 3v10"/>',
    output: '<path d="M3 3v10"/><path d="M3 8h9"/><path d="m8 4 4 4-4 4"/>',
    forward: '<path d="m2 4 4 4-4 4"/><path d="m8 4 4 4-4 4"/>',
  };

  function directionIcon(direction) {
    if (ui.isUnset(direction)) return h('span', { class: 'muted' }, ui.EMPTY);
    const label = DIRECTION_LABEL[direction] || direction;
    const path = DIRECTION_ICON[direction];
    if (!path) return h('span', null, label);
    return h('span', { class: 'type-icon', title: label, 'aria-label': label },
      h('span', {
        'aria-hidden': 'true',
        html: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>',
      }));
  }

  /* ---------- NAT rule_type labels (badge colors/text for protocol live in ui.protocolBadge) ---------- */

  const PROTOCOL_LABEL = { icmpv6: 'ICMPv6' };
  const SNAT_TYPE_LABEL = { snat: 'SNAT', masquerade: 'Masquerade', netmap: 'NetMap' };
  const DNAT_TYPE_LABEL = { dnat: 'DNAT', portforward: 'Port forward', netmap: 'NetMap' };

  /* ---------- Active pill (shared by every column and detail panel below) ---------- */

  function activePill(active) {
    return active === undefined ? h('span', { class: 'muted' }, ui.EMPTY) : ui.statusPill(active);
  }

  function portRange(start, end) {
    if (ui.isUnset(start)) return ui.isUnset(end) ? undefined : end;
    if (ui.isUnset(end) || end === start) return start;
    return start + '–' + end;
  }

  function distinctValues(rules, field) {
    const seen = new Set();
    rules.forEach(function (r) { if (!ui.isUnset(r[field])) seen.add(r[field]); });
    return Array.from(seen).sort();
  }

  function filterSelect(label, options, allLabel) {
    return h('select', { class: 'rule-filter', 'aria-label': label },
      h('option', { value: '' }, allLabel),
      options.map(function (o) { return h('option', { value: o.value }, o.label); }));
  }

  /** Lower-cased text of every string field on the rule, including ones not shown as a column. */
  function ruleSearchText(rule) {
    return Object.keys(rule)
      .filter(function (k) { return k !== '_index' && typeof rule[k] === 'string'; })
      .map(function (k) { return rule[k]; })
      .concat(String(rule._index))
      .join(' ')
      .toLowerCase();
  }

  /* ---------- IP filter rules ---------- */

  function detailPanel(rule, netsByName) {
    const groups = [
      ui.detailGroup('Rule', [
        ['Active', rule.rule_active === undefined ? undefined : activePill(rule.rule_active)],
        ['Type', rule.rule_direction === undefined ? undefined : (DIRECTION_LABEL[rule.rule_direction] || rule.rule_direction)],
        ['Protocol', rule.rule_protocol === undefined ? undefined : ui.protocolBadge(rule.rule_protocol)],
        ['Rule name', rule.rule_name],
        ['Description', rule.rule_description],
      ]),
      ui.detailGroup('Match', [
        ['From', rule.rule_input_if === undefined ? undefined : ui.ifaceChips(rule.rule_input_if, netsByName)],
        ['To', rule.rule_output_if === undefined ? undefined : ui.ifaceChips(rule.rule_output_if, netsByName)],
        ['Source address', ui.formatCidr(rule.rule_saddr, rule.rule_snetmask)],
        ['Source port', portRange(rule.rule_sport, rule.rule_sport_end)],
        ['Destination address', ui.formatCidr(rule.rule_daddr, rule.rule_dnetmask)],
        ['Destination port', portRange(rule.rule_dport, rule.rule_dport_end)],
        ['IP version', rule.rule_ipversion],
      ]),
    ].filter(Boolean);
    if (!groups.length) return ui.emptyNote('No further settings for this rule.');
    return h('div', { class: 'detail-panel' }, groups);
  }

  function ipFilterCard(config, netsByName) {
    const rules = config.list('netfilter.ip_filter.rule');
    if (!rules.length) {
      return ui.card({ title: 'Firewall rules', className: 'card-firewall', body: ui.emptyNote('No IP filter rules in this config.') });
    }

    const search = h('input', { type: 'search', class: 'rule-search', placeholder: 'Search all rule fields…', 'aria-label': 'Search all rule fields' });
    const activeFilter = filterSelect('Filter by active state', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }], 'All');
    const directionFilter = filterSelect('Filter by type', distinctValues(rules, 'rule_direction').map(function (v) { return { value: v, label: DIRECTION_LABEL[v] || v }; }), 'All');
    const protocolFilter = filterSelect('Filter by protocol', distinctValues(rules, 'rule_protocol').map(function (v) { return { value: v, label: PROTOCOL_LABEL[v] || v.toUpperCase() }; }), 'All');
    const fromFilter = h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': 'Filter by "from" interface' });
    const toFilter = h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': 'Filter by "to" interface' });
    const descFilter = h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': 'Filter by description' });

    const resultCount = h('span', { class: 'rule-count' }, rules.length + ' rules');

    const entries = rules.map(function (rule) {
      const detail = h('tr', { class: 'row-detail', hidden: true }, h('td', { colspan: '7' }, detailPanel(rule, netsByName)));
      const tr = h('tr', {
        class: 'rule-row',
        tabindex: '0',
        role: 'button',
        'aria-expanded': 'false',
      },
        h('td', { class: 'muted' }, String(rule._index)),
        h('td', null, activePill(rule.rule_active)),
        h('td', null, directionIcon(rule.rule_direction)),
        h('td', null, ui.protocolBadge(rule.rule_protocol)),
        h('td', null, ui.ifaceChips(rule.rule_input_if, netsByName)),
        h('td', null, ui.ifaceChips(rule.rule_output_if, netsByName)),
        h('td', null, ui.isUnset(rule.rule_description) ? h('span', { class: 'muted' }, ui.EMPTY) : rule.rule_description));

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

      return { rule: rule, searchText: ruleSearchText(rule), tr: tr, detail: detail };
    });

    function applyFilters() {
      const q = search.value.trim().toLowerCase();
      const direction = directionFilter.value;
      const protocol = protocolFilter.value;
      const active = activeFilter.value;
      const from = fromFilter.value.trim().toLowerCase();
      const to = toFilter.value.trim().toLowerCase();
      const desc = descFilter.value.trim().toLowerCase();

      let visible = 0;
      entries.forEach(function (entry) {
        const r = entry.rule;
        const matches = (!q || entry.searchText.indexOf(q) !== -1) &&
          (!direction || r.rule_direction === direction) &&
          (!protocol || r.rule_protocol === protocol) &&
          (!active || ui.isOn(r.rule_active) === (active === '1')) &&
          (!from || (r.rule_input_if || '').toLowerCase().indexOf(from) !== -1) &&
          (!to || (r.rule_output_if || '').toLowerCase().indexOf(to) !== -1) &&
          (!desc || (r.rule_description || '').toLowerCase().indexOf(desc) !== -1);
        entry.tr.hidden = !matches;
        if (!matches) {
          entry.detail.hidden = true;
          entry.tr.classList.remove('open');
          entry.tr.setAttribute('aria-expanded', 'false');
        } else {
          visible++;
        }
      });
      resultCount.textContent = visible === entries.length ? entries.length + ' rules' : visible + ' / ' + entries.length + ' rules';
    }

    [search, activeFilter, directionFilter, protocolFilter, fromFilter, toFilter, descFilter].forEach(function (el) {
      el.addEventListener('input', applyFilters);
      el.addEventListener('change', applyFilters);
    });

    const tbody = h('tbody', null, entries.map(function (entry) { return [entry.tr, entry.detail]; }));

    const table = h('table', { class: 'table table-expand' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Nr.'), h('th', null, 'Active'), h('th', null, 'Type'), h('th', null, 'Protocol'),
          h('th', null, 'From'), h('th', null, 'To'), h('th', null, 'Description')),
        h('tr', { class: 'rule-filter-row' },
          h('th', null), h('th', null, activeFilter), h('th', null, directionFilter), h('th', null, protocolFilter),
          h('th', null, fromFilter), h('th', null, toFilter), h('th', null, descFilter))),
      tbody);

    return ui.card({
      title: 'Firewall rules',
      className: 'card-firewall',
      body: [
        h('div', { class: 'rule-toolbar' }, search, resultCount),
        h('div', { class: 'table-wrap' }, table),
      ],
    });
  }

  /* ---------- NAT (Source NAT / Destination NAT) ---------- */

  /**
   * Builds one card with a searchable/filterable rule table, shared by the Source NAT
   * and Destination NAT sections (same interaction as the IP filter table above, but
   * with a rule_type instead of rule_direction and a single interface column).
   *
   * @param {object} opts
   * @param {string} opts.title Card title.
   * @param {Array} opts.rules Rules from config.list(...), each with rule_type/rule_protocol/... .
   * @param {object} opts.netsByName IP net lookup for interface chip colors.
   * @param {object} opts.typeLabels rule_type value -> display label.
   * @param {string} opts.ifaceField rule_input_if or rule_output_if.
   * @param {string} opts.ifaceColumn Column header for the interface field.
   * @param {string} opts.noRulesText Empty-state text when there are no rules at all.
   * @param {function(object): Array} opts.extraDetailRows Extra [label, value] pairs for the detail panel.
   */
  function natRuleTableCard(opts) {
    const rules = opts.rules;
    if (!rules.length) {
      return ui.card({ title: opts.title, body: ui.emptyNote(opts.noRulesText) });
    }

    const netsByName = opts.netsByName;

    function natDetailPanel(rule) {
      const groups = [
        ui.detailGroup('Rule', [
          ['Active', rule.rule_active === undefined ? undefined : activePill(rule.rule_active)],
          ['Type', rule.rule_type === undefined ? undefined : (opts.typeLabels[rule.rule_type] || rule.rule_type)],
          ['Protocol', rule.rule_protocol === undefined ? undefined : ui.protocolBadge(rule.rule_protocol)],
          [opts.ifaceColumn, rule[opts.ifaceField] === undefined ? undefined : ui.ifaceChips(rule[opts.ifaceField], netsByName)],
          ['Rule name', rule.rule_name],
          ['Description', rule.rule_description],
        ]),
        ui.detailGroup('Match & translation', opts.extraDetailRows(rule)),
      ].filter(Boolean);
      if (!groups.length) return ui.emptyNote('No further settings for this rule.');
      return h('div', { class: 'detail-panel' }, groups);
    }

    const search = h('input', { type: 'search', class: 'rule-search', placeholder: 'Search all rule fields…', 'aria-label': 'Search all rule fields' });
    const activeFilter = filterSelect('Filter by active state', [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }], 'All');
    const typeFilter = filterSelect('Filter by type', distinctValues(rules, 'rule_type').map(function (v) { return { value: v, label: opts.typeLabels[v] || v }; }), 'All');
    const protocolFilter = filterSelect('Filter by protocol', distinctValues(rules, 'rule_protocol').map(function (v) { return { value: v, label: PROTOCOL_LABEL[v] || v.toUpperCase() }; }), 'All');
    const ifaceFilter = h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': 'Filter by ' + opts.ifaceColumn.toLowerCase() });
    const descFilter = h('input', { type: 'text', class: 'rule-filter', placeholder: '…', 'aria-label': 'Filter by description' });

    const resultCount = h('span', { class: 'rule-count' }, rules.length + ' rules');

    const entries = rules.map(function (rule) {
      const detail = h('tr', { class: 'row-detail', hidden: true }, h('td', { colspan: '6' }, natDetailPanel(rule)));
      const tr = h('tr', {
        class: 'rule-row',
        tabindex: '0',
        role: 'button',
        'aria-expanded': 'false',
      },
        h('td', { class: 'muted' }, String(rule._index)),
        h('td', null, activePill(rule.rule_active)),
        h('td', null, ui.isUnset(rule.rule_type) ? h('span', { class: 'muted' }, ui.EMPTY) : (opts.typeLabels[rule.rule_type] || rule.rule_type)),
        h('td', null, ui.protocolBadge(rule.rule_protocol)),
        h('td', null, ui.ifaceChips(rule[opts.ifaceField], netsByName)),
        h('td', null, ui.isUnset(rule.rule_description) ? h('span', { class: 'muted' }, ui.EMPTY) : rule.rule_description));

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

      return { rule: rule, searchText: ruleSearchText(rule), tr: tr, detail: detail };
    });

    function applyFilters() {
      const q = search.value.trim().toLowerCase();
      const type = typeFilter.value;
      const protocol = protocolFilter.value;
      const active = activeFilter.value;
      const iface = ifaceFilter.value.trim().toLowerCase();
      const desc = descFilter.value.trim().toLowerCase();

      let visible = 0;
      entries.forEach(function (entry) {
        const r = entry.rule;
        const matches = (!q || entry.searchText.indexOf(q) !== -1) &&
          (!type || r.rule_type === type) &&
          (!protocol || r.rule_protocol === protocol) &&
          (!active || ui.isOn(r.rule_active) === (active === '1')) &&
          (!iface || (r[opts.ifaceField] || '').toLowerCase().indexOf(iface) !== -1) &&
          (!desc || (r.rule_description || '').toLowerCase().indexOf(desc) !== -1);
        entry.tr.hidden = !matches;
        if (!matches) {
          entry.detail.hidden = true;
          entry.tr.classList.remove('open');
          entry.tr.setAttribute('aria-expanded', 'false');
        } else {
          visible++;
        }
      });
      resultCount.textContent = visible === entries.length ? entries.length + ' rules' : visible + ' / ' + entries.length + ' rules';
    }

    [search, activeFilter, typeFilter, protocolFilter, ifaceFilter, descFilter].forEach(function (el) {
      el.addEventListener('input', applyFilters);
      el.addEventListener('change', applyFilters);
    });

    const tbody = h('tbody', null, entries.map(function (entry) { return [entry.tr, entry.detail]; }));

    const table = h('table', { class: 'table table-expand' },
      h('thead', null,
        h('tr', null,
          h('th', null, 'Nr.'), h('th', null, 'Active'), h('th', null, 'Type'), h('th', null, 'Protocol'),
          h('th', null, opts.ifaceColumn), h('th', null, 'Description')),
        h('tr', { class: 'rule-filter-row' },
          h('th', null), h('th', null, activeFilter), h('th', null, typeFilter), h('th', null, protocolFilter),
          h('th', null, ifaceFilter), h('th', null, descFilter))),
      tbody);

    return ui.card({
      title: opts.title,
      body: [
        h('div', { class: 'rule-toolbar' }, search, resultCount),
        h('div', { class: 'table-wrap' }, table),
      ],
    });
  }

  function sourceNatCard(config, netsByName) {
    return natRuleTableCard({
      title: 'Source NAT rules',
      rules: config.list('netfilter.nat.snat.rule'),
      netsByName: netsByName,
      typeLabels: SNAT_TYPE_LABEL,
      ifaceField: 'rule_output_if',
      ifaceColumn: 'Output interface',
      noRulesText: 'No source NAT rules in this config.',
      extraDetailRows: function (rule) {
        return [
          ['Source address', ui.formatCidr(rule.rule_saddr, rule.rule_snetmask)],
          ['Source port', portRange(rule.rule_sport, rule.rule_sport_end)],
          ['Destination address', ui.formatCidr(rule.rule_daddr, rule.rule_dnetmask)],
          ['Destination port', portRange(rule.rule_dport, rule.rule_dport_end)],
          ['Translated address', rule.rule_snat_addr],
          ['Translated port', portRange(rule.rule_snat_port, rule.rule_snat_port_end)],
        ];
      },
    });
  }

  function destinationNatCard(config, netsByName) {
    return natRuleTableCard({
      title: 'Destination NAT rules',
      rules: config.list('netfilter.nat.dnat.rule'),
      netsByName: netsByName,
      typeLabels: DNAT_TYPE_LABEL,
      ifaceField: 'rule_input_if',
      ifaceColumn: 'Input interface',
      noRulesText: 'No destination NAT rules in this config.',
      extraDetailRows: function (rule) {
        return [
          ['Source address', ui.formatCidr(rule.rule_saddr, rule.rule_snetmask)],
          ['Source port', portRange(rule.rule_sport, rule.rule_sport_end)],
          ['Destination address', ui.formatCidr(rule.rule_daddr, rule.rule_dnetmask)],
          ['Destination port', portRange(rule.rule_dport, rule.rule_dport_end)],
          ['Translated address', rule.rule_dnat_addr],
          ['Translated port', portRange(rule.rule_dnat_port, rule.rule_dnat_port_end)],
        ];
      },
    });
  }

  function render(config) {
    const netsByName = {};
    config.list('interfaces.ip_nets.net').forEach(function (n) { netsByName[n.name] = n; });

    return h('div', { class: 'firewall' },
      ipFilterCard(config, netsByName),
      sourceNatCard(config, netsByName),
      destinationNatCard(config, netsByName));
  }

  RouterLens.views.register({ id: 'firewall', label: 'Firewall', icon: ICON, device: 'insys', render: render });
})(window);
