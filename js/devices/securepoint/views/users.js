/*
 * Securepoint users and user groups: one card per group with its permission and members,
 * plus the full user table. (The dashboard only shows the compact user list.)
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const ui = RouterLens.ui;
  const spui = RouterLens.spui;
  const h = ui.h;

  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>' +
    '<path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M18 14.3c1.8.7 3 2.4 3 4.7"/></svg>';

  function memberChip(user) {
    return h('span', { class: 'chip', style: { '--chip': 'var(--primary)' } }, h('span', { class: 'chip-dot' }), user.name);
  }

  function groupCard(report, group) {
    const members = report.users.filter(function (u) { return u.groups.indexOf(group.name) !== -1; });
    return ui.card({
      title: group.name,
      subtitle: spui.permissionLabel(group.permission) || null,
      aside: group.permission ? h('span', { class: 'pill pill-info' }, group.permission) : null,
      body: ui.kvList([
        ['Directory name', group.directoryName || ''],
        ['Members', members.length ? members.map(memberChip) : ''],
        ['Group ID', group.id === null ? undefined : String(group.id)],
      ]),
    });
  }

  function groupsSection(report) {
    const cards = report.userGroups.map(function (g) { return groupCard(report, g); });
    return ui.section('User groups', cards.length,
      cards.length ? h('div', { class: 'grid' }, cards) : ui.emptyNote('No user groups configured.'));
  }

  function usersSection(report) {
    if (!report.users.length) return ui.section('Users', 0, ui.emptyNote('No users configured.'));
    const rows = report.users.map(function (u) {
      return h('tr', null,
        h('td', null, spui.orDash(u.name)),
        h('td', null, u.groups.length ? u.groups.map(function (g) { return h('span', { class: 'pill pill-info' }, g); }) : spui.dash()),
        h('td', null, spui.permissionLabel(u.permission) || h('span', { class: 'muted' }, ui.EMPTY)),
        h('td', { class: 'muted' }, u.id === null ? ui.EMPTY : String(u.id)));
    });
    const table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'User'), h('th', null, 'Groups'), h('th', null, 'Permission'), h('th', null, 'ID'))),
      h('tbody', null, rows));
    return ui.section('Users', report.users.length,
      ui.card({ title: 'All users', body: h('div', { class: 'table-wrap' }, table) }));
  }

  function render(report) {
    return h('div', { class: 'users' }, groupsSection(report), usersSection(report));
  }

  RouterLens.views.register({ id: 'users', label: 'Users', icon: ICON, device: 'securepoint', render: render });
})(window);
