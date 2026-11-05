/*
 * Small DOM helpers shared by all views.
 * All config values are inserted as text nodes, never as HTML.
 */
(function (root) {
  'use strict';

  const RouterLens = (root.RouterLens = root.RouterLens || {});

  /** h('div', { class: 'x', onclick: fn }, child, 'text', [more]) */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue;
        if (name.startsWith('on') && typeof value === 'function') {
          el.addEventListener(name.slice(2), value);
        } else if (name === 'style' && typeof value === 'object') {
          for (const [prop, v] of Object.entries(value)) {
            if (v !== undefined && v !== null && v !== '') el.style.setProperty(prop, v);
          }
        } else if (name === 'html') {
          el.innerHTML = value; // only for trusted, static markup (icons)
        } else {
          el.setAttribute(name, value === true ? '' : value);
        }
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(el, c); });
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }

  const EMPTY = '—';

  function isOn(value) {
    return value === '1';
  }

  /** Converts "24" or "255.255.255.0" to "/24 (255.255.255.0)". */
  function formatNetmask(mask) {
    if (mask === undefined || mask === '') return mask;
    if (/^\d{1,2}$/.test(mask)) {
      const bits = Number(mask);
      if (bits > 32) return '/' + mask; // IPv6 prefix length
      const octets = [];
      for (let i = 0; i < 4; i++) {
        const b = Math.max(0, Math.min(8, bits - i * 8));
        octets.push(256 - Math.pow(2, 8 - b));
      }
      return '/' + bits + ' (' + octets.join('.') + ')';
    }
    return mask;
  }

  function formatCidr(ip, mask) {
    if (!ip) return ip;
    if (!mask) return ip;
    return /^\d{1,3}$/.test(mask) ? ip + '/' + mask : ip + ' / ' + mask;
  }

  /** Placeholder "---" means "nothing selected" in icom OS. */
  function isUnset(value) {
    return value === undefined || value === '' || value === '---';
  }

  function statusPill(active) {
    const on = isOn(active);
    return h('span', { class: 'pill ' + (on ? 'pill-on' : 'pill-off') }, on ? 'Active' : 'Inactive');
  }

  function flag(value) {
    if (value === undefined) return undefined;
    const on = isOn(value);
    return h('span', { class: 'flag ' + (on ? 'flag-on' : 'flag-off') },
      h('span', { class: 'flag-dot' }), on ? 'On' : 'Off');
  }

  /**
   * Key/value list. Rows whose value is `undefined` (key not in config) are skipped,
   * empty strings are rendered as a dash (configured but empty).
   */
  function kvList(rows) {
    const dl = h('dl', { class: 'kv' });
    rows.forEach(function (row) {
      if (!row) return;
      const label = row[0];
      const value = row[1];
      if (value === undefined) return;
      const dd = h('dd');
      if (value === '' || value === '---') {
        dd.classList.add('muted');
        dd.textContent = EMPTY;
      } else {
        append(dd, value);
      }
      dl.appendChild(h('dt', null, label));
      dl.appendChild(dd);
    });
    return dl.childNodes.length ? dl : null;
  }

  function card(options) {
    const classes = ['card'];
    if (options.inactive) classes.push('card-inactive');
    if (options.className) classes.push(options.className);
    return h('article', { class: classes.join(' '), style: options.accent ? { '--accent': options.accent } : null },
      h('header', { class: 'card-head' },
        h('div', { class: 'card-titles' },
          h('h3', { class: 'card-title' }, options.title),
          options.subtitle ? h('p', { class: 'card-subtitle' }, options.subtitle) : null),
        options.aside ? h('div', { class: 'card-aside' }, options.aside) : null),
      h('div', { class: 'card-body' }, options.body));
  }

  function section(title, count, content) {
    return h('section', { class: 'section' },
      h('h2', { class: 'section-title' }, title,
        count !== undefined ? h('span', { class: 'count' }, String(count)) : null),
      content);
  }

  function emptyNote(text) {
    return h('p', { class: 'empty-note' }, text);
  }

  /* ---------- Modal ---------- */

  let modalBackdrop = null;
  let modalKeyHandler = null;

  function closeModal() {
    if (!modalBackdrop) return;
    document.removeEventListener('keydown', modalKeyHandler);
    modalBackdrop.remove();
    modalBackdrop = null;
    modalKeyHandler = null;
  }

  /** Single-instance dialog for "show everything" details that don't fit a card. */
  function openModal(options) {
    closeModal();
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('header', { class: 'modal-head' },
        h('div', { class: 'modal-titles' },
          h('h3', { class: 'modal-title' }, options.title),
          options.subtitle ? h('p', { class: 'modal-subtitle' }, options.subtitle) : null),
        h('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close', onclick: closeModal }, '×')),
      h('div', { class: 'modal-body' }, options.body));
    modalBackdrop = h('div', {
      class: 'modal-backdrop',
      onclick: function (e) { if (e.target === modalBackdrop) closeModal(); },
    }, dialog);
    document.body.appendChild(modalBackdrop);
    modalKeyHandler = function (e) { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', modalKeyHandler);
  }

  /** A labelled group of kv rows inside a modal; omitted entirely when every row is empty. */
  function detailGroup(title, rows) {
    const list = kvList(rows);
    if (!list) return null;
    return h('div', { class: 'detail-group' }, h('h4', { class: 'detail-group-title' }, title), list);
  }

  /** Footer link on a card that opens a modal with the full field set. */
  function moreLink(onOpen) {
    return h('div', { class: 'card-more' },
      h('button', { class: 'link-btn', type: 'button', onclick: onOpen }, 'More details…'));
  }

  /* ---------- netfilter (firewall / NAT) rule fields, shared across views ---------- */

  const KNOWN_PROTOCOLS = ['tcp', 'udp', 'icmp', 'icmpv6', 'esp', 'all'];
  const PROTOCOL_LABEL = { icmpv6: 'ICMPv6' };

  function protocolBadge(protocol) {
    if (isUnset(protocol)) return h('span', { class: 'muted' }, EMPTY);
    const known = KNOWN_PROTOCOLS.indexOf(protocol) !== -1;
    const label = PROTOCOL_LABEL[protocol] || protocol.toUpperCase();
    return h('span', { class: 'badge badge-' + (known ? protocol : 'other') }, label);
  }

  /** A single "netX" / "openvpnX" / "all" interface as a colored chip, using the IP net's own color when known. */
  function ifaceChip(name, netsByName) {
    if (name === 'all') return h('span', { class: 'chip chip-all' }, h('span', { class: 'chip-dot' }), 'All');
    const net = netsByName[name];
    return h('span', { class: 'chip', style: net && net.color ? { '--chip': net.color } : null, title: net ? net.description : null },
      h('span', { class: 'chip-dot' }), name);
  }

  /** Comma separated interface list (icom OS's rule_*_if fields) as chips. */
  function ifaceChips(value, netsByName) {
    if (isUnset(value)) return h('span', { class: 'muted' }, EMPTY);
    return value.split(',').map(function (n) { return n.trim(); }).filter(Boolean)
      .map(function (n) { return ifaceChip(n, netsByName); });
  }

  RouterLens.ui = {
    h: h,
    EMPTY: EMPTY,
    isOn: isOn,
    isUnset: isUnset,
    formatNetmask: formatNetmask,
    formatCidr: formatCidr,
    statusPill: statusPill,
    flag: flag,
    kvList: kvList,
    card: card,
    section: section,
    emptyNote: emptyNote,
    openModal: openModal,
    closeModal: closeModal,
    detailGroup: detailGroup,
    moreLink: moreLink,
    protocolBadge: protocolBadge,
    ifaceChips: ifaceChips,
  };
})(window);
