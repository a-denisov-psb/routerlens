/*
 * App shell: view registry, icon navigation, file loading.
 * The config file is read with FileReader only – nothing leaves the browser.
 */
(function (root) {
  'use strict';

  const RouterLens = (root.RouterLens = root.RouterLens || {});

  /* ---------- View registry ---------- */

  const views = [];

  RouterLens.views = {
    /**
     * Registers a navigation entry. `device` selects the router type the entry belongs to
     * ('insys' by default, 'securepoint'); `render` receives that device's parsed data and a
     * context `{ sub }` with the optional second hash segment (#view/sub).
     * @param {{id: string, label: string, icon: string, device?: string, render: function(*, {sub: ?string}): Node}} view
     */
    register: function (view) {
      views.push(Object.assign({ device: 'insys' }, view));
    },
    all: function () {
      return views.slice();
    },
  };

  /* ---------- Devices ---------- */

  const PDFJS_DIR = 'js/vendor/pdfjs/';

  /** Per router type: how to read the hostname shown in the top bar. */
  const DEVICES = {
    insys: {
      label: 'INSYS icom OS',
      hostname: function (config) { return config.get('administration.hostnames.hostname'); },
    },
    securepoint: {
      label: 'Securepoint UTM',
      hostname: function (report) { return report.system.hostname; },
    },
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(el);
    });
  }

  let pdfjsReady = null;
  /** pdf.js is large and only needed for Securepoint reports, so it is loaded on first use. */
  function loadPdfjs() {
    if (!pdfjsReady) {
      pdfjsReady = loadScript(PDFJS_DIR + 'pdf.min.js').then(function () {
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.js';
        return root.pdfjsLib;
      });
      pdfjsReady.catch(function () { pdfjsReady = null; });
    }
    return pdfjsReady;
  }

  function readFile(file, asBuffer) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read "' + file.name + '".')); };
      if (asBuffer) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  /** Reads a file and returns { device, data } or throws an Error with a user-facing message. */
  async function openFile(file) {
    if (/\.pdf$/i.test(file.name)) {
      const buffer = await readFile(file, true);
      const pdfjs = await loadPdfjs();
      let pages;
      try {
        pages = await RouterLens.securepointPdf.extractPages(pdfjs, buffer);
      } catch (err) {
        throw new Error('Could not read "' + file.name + '" as a PDF: ' + err.message);
      }
      if (!RouterLens.securepoint.detect(pages)) {
        throw new Error('"' + file.name + '" is not a Securepoint UTM report.');
      }
      return { device: 'securepoint', data: RouterLens.securepoint.parseReport(pages) };
    }
    let config;
    try {
      config = RouterLens.parser.parseConfig(await readFile(file, false));
    } catch (err) {
      throw new Error('Could not parse "' + file.name + '": ' + err.message);
    }
    if (!config.values.size) throw new Error('"' + file.name + '" contains no icom OS configuration entries.');
    return { device: 'insys', data: config };
  }

  /* ---------- State ---------- */

  const state = {
    device: null,
    config: null, // parsed data of the loaded file (icom OS Config or Securepoint report)
    fileName: null,
    viewId: null,
  };

  function deviceViews() {
    return views.filter(function (v) { return v.device === state.device; });
  }

  /* ---------- Bootstrapping (called after all view scripts loaded) ---------- */

  RouterLens.start = function () {
    const ui = RouterLens.ui;
    const h = ui.h;

    const nav = document.getElementById('nav');
    const main = document.getElementById('main');
    const fileInput = document.getElementById('file-input');
    const title = document.getElementById('topbar-title');
    const meta = document.getElementById('topbar-meta');
    const themeToggle = document.getElementById('theme-toggle');

    let navDevice = null;

    /** The rail only lists the views of the loaded router type. */
    function buildNav() {
      if (navDevice === state.device) return;
      navDevice = state.device;
      nav.replaceChildren();
      deviceViews().forEach(function (view) {
        nav.appendChild(h('a', {
          class: 'nav-item',
          href: '#' + view.id,
          'data-view': view.id,
          title: view.label,
          'aria-label': view.label,
        }, h('span', { class: 'nav-icon', html: view.icon }), h('span', { class: 'nav-label' }, view.label)));
      });
    }

    document.querySelectorAll('[data-action="open-file"]').forEach(function (btn) {
      btn.addEventListener('click', function () { fileInput.click(); });
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files[0]) loadFile(fileInput.files[0]);
      fileInput.value = '';
    });

    themeToggle.addEventListener('click', function () {
      setTheme(isDarkActive() ? 'light' : 'dark');
    });
    syncThemeToggleLabel();

    root.addEventListener('hashchange', function () {
      const id = viewFromHash();
      if (id) {
        state.viewId = id;
        render();
      }
    });

    // Drag & drop anywhere on the page.
    let dragDepth = 0;
    document.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragDepth++;
      document.body.classList.add('dragging');
    });
    document.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove('dragging');
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('dragging');
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    function isDarkActive() {
      const theme = document.documentElement.dataset.theme;
      return theme === 'dark' || (!theme && root.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function setTheme(theme) {
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('routerlens-theme', theme); } catch (e) { /* localStorage unavailable */ }
      syncThemeToggleLabel();
    }

    function syncThemeToggleLabel() {
      const label = isDarkActive() ? 'Switch to light mode' : 'Switch to dark mode';
      themeToggle.title = label;
      themeToggle.setAttribute('aria-label', label);
    }

    /** The hash is "#<view>" or "#<view>/<sub>"; the sub part lets a view address its own tabs. */
    function viewFromHash() {
      const id = root.location.hash.slice(1).split('/')[0];
      return deviceViews().some(function (v) { return v.id === id; }) ? id : null;
    }

    function subFromHash() {
      const parts = root.location.hash.slice(1).split('/');
      return parts.length > 1 && parts[1] ? parts[1] : null;
    }

    function loadFile(file) {
      openFile(file).then(function (result) {
        state.device = result.device;
        state.config = result.data;
        state.fileName = file.name;
        state.viewId = viewFromHash() || (deviceViews()[0] && deviceViews()[0].id);
        render();
      }).catch(function (err) {
        state.config = null;
        state.device = null;
        showError(err.message);
      });
    }

    function showError(message) {
      render();
      main.prepend(h('div', { class: 'alert', role: 'alert' }, message));
    }

    function render() {
      buildNav();
      nav.querySelectorAll('.nav-item').forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('data-view') === state.viewId);
      });

      main.replaceChildren();
      document.body.classList.toggle('has-config', !!state.config);

      if (!state.config) {
        title.textContent = 'RouterLens';
        meta.replaceChildren();
        main.appendChild(emptyState());
        return;
      }

      const available = deviceViews();
      const view = available.find(function (v) { return v.id === state.viewId; }) || available[0];
      if (!view) {
        title.textContent = 'RouterLens';
        main.appendChild(ui.emptyNote('No views are available for this router type yet.'));
        return;
      }
      const hostname = DEVICES[state.device].hostname(state.config);
      title.textContent = view.label;
      meta.replaceChildren.apply(meta, [
        hostname ? h('span', { class: 'meta-host' }, hostname) : null,
        h('span', { class: 'meta-file', title: state.fileName }, state.fileName),
        state.config.warnings && state.config.warnings.length
          ? h('span', { class: 'meta-warn', title: state.config.warnings.map(function (w) { return 'Line ' + w.line + ': ' + w.message + ' (' + w.text + ')'; }).join('\n') },
            state.config.warnings.length + ' parser warning' + (state.config.warnings.length > 1 ? 's' : ''))
          : null,
      ].filter(Boolean));

      main.appendChild(view.render(state.config, { sub: subFromHash() }));
      document.title = (hostname ? hostname + ' · ' : '') + view.label + ' · RouterLens';
    }

    function emptyState() {
      return h('div', { class: 'empty-state' },
        h('div', { class: 'dropzone' },
          h('div', { class: 'dropzone-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>' }),
          h('h1', null, 'Open a router config export'),
          h('p', null, 'Drop an INSYS icom OS export (', h('code', null, '.txt'), ') or a Securepoint UTM report (',
            h('code', null, '.pdf'), ') here or choose it from disk.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { fileInput.click(); } }, 'Choose file'),
          h('p', { class: 'privacy' }, 'The file is parsed locally in your browser and is never uploaded.')));
    }

    render();
  };
})(window);
