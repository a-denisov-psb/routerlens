/*
 * App shell: device registry, view registry, icon navigation, file loading.
 *
 * The core knows nothing about any particular router or switch. Every supported device type
 * lives in its own module under js/devices/<id>/ and plugs in through two registries:
 *
 *   RouterLens.devices.register({...})  how to recognize and parse a file of that type
 *   RouterLens.views.register({...})    navigation entries rendered for that type
 *
 * Files are read with FileReader only – nothing leaves the browser.
 */
(function (root) {
  'use strict';

  const RouterLens = (root.RouterLens = root.RouterLens || {});

  /* ---------- Device registry ---------- */

  const devices = [];

  RouterLens.devices = {
    /**
     * Registers a device type. Devices are tried in registration order; the first whose
     * `open` returns data wins.
     * @param {{
     *   id: string,                 unique id, referenced by views (e.g. 'insys')
     *   label: string,              human readable name (e.g. 'INSYS icom OS')
     *   fileLabel: string,          what to drop, for the start page (e.g. 'an INSYS icom OS export (.txt)')
     *   extensions: string[],       file name extensions this device may come as (e.g. ['.txt'])
     *   binary?: boolean,           true: `open` receives an ArrayBuffer instead of text
     *   open: function((string|ArrayBuffer), File): (Promise<*>|*),
     *                               parsed data, or null when the content is not this device's format;
     *                               throws an Error with a user-facing message for a broken file of its format
     *   hostname?: function(*): ?string   name shown in the top bar
     * }} device
     */
    register: function (device) {
      if (!device || !device.id || typeof device.open !== 'function') {
        throw new Error('RouterLens.devices.register: id and open() are required');
      }
      if (devices.some(function (d) { return d.id === device.id; })) {
        throw new Error('RouterLens.devices.register: duplicate device id "' + device.id + '"');
      }
      devices.push(Object.assign({ extensions: [], binary: false }, device));
    },
    get: function (id) {
      return devices.find(function (d) { return d.id === id; }) || null;
    },
    all: function () {
      return devices.slice();
    },
  };

  /* ---------- View registry ---------- */

  const views = [];

  RouterLens.views = {
    /**
     * Registers a navigation entry of one device type. `render` receives that device's parsed
     * data and a context `{ sub }` with the optional second hash segment (#view/sub).
     * @param {{id: string, label: string, icon: string, device: string, render: function(*, {sub: ?string}): Node}} view
     */
    register: function (view) {
      if (!view || !view.device) throw new Error('RouterLens.views.register: "device" is required (view "' + (view && view.id) + '")');
      views.push(view);
    },
    all: function () {
      return views.slice();
    },
  };

  /* ---------- Shared helpers for device modules ---------- */

  const scripts = {};

  /** Loads a script once (e.g. a large library only one device needs) and resolves when it ran. */
  RouterLens.loadScript = function (src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = function () { reject(new Error('Could not load ' + src)); };
        document.head.appendChild(el);
      });
      scripts[src].catch(function () { delete scripts[src]; });
    }
    return scripts[src];
  };

  /* ---------- File loading ---------- */

  function readFile(file, asBuffer) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('Could not read "' + file.name + '".')); };
      if (asBuffer) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    });
  }

  function extensionOf(name) {
    const m = /(\.[^.]+)$/.exec(name);
    return m ? m[1].toLowerCase() : '';
  }

  /**
   * Hands the file to every device module that accepts its extension (all of them if none does)
   * and returns { device, data } of the first one that recognizes it.
   */
  async function openFile(file) {
    const ext = extensionOf(file.name);
    let candidates = devices.filter(function (d) { return d.extensions.indexOf(ext) !== -1; });
    if (!candidates.length) candidates = devices;

    const contents = {};
    for (const device of candidates) {
      const kind = device.binary ? 'buffer' : 'text';
      if (!(kind in contents)) contents[kind] = await readFile(file, device.binary);
      const data = await device.open(contents[kind], file);
      if (data) return { device: device.id, data: data };
    }
    throw new Error('"' + file.name + '" is not a supported file. Supported: ' +
      devices.map(function (d) { return d.label; }).join(', ') + '.');
  }

  /* ---------- State ---------- */

  const state = {
    device: null,
    config: null, // parsed data of the loaded file, as returned by the device module
    fileName: null,
    viewId: null,
  };

  function deviceViews() {
    return views.filter(function (v) { return v.device === state.device; });
  }

  /* ---------- Bootstrapping (called after all device and view scripts loaded) ---------- */

  RouterLens.start = function () {
    const ui = RouterLens.ui;
    const h = ui.h;

    const nav = document.getElementById('nav');
    const main = document.getElementById('main');
    const fileInput = document.getElementById('file-input');
    const title = document.getElementById('topbar-title');
    const meta = document.getElementById('topbar-meta');
    const themeToggle = document.getElementById('theme-toggle');

    const extensions = [];
    devices.forEach(function (d) {
      d.extensions.forEach(function (e) { if (extensions.indexOf(e) === -1) extensions.push(e); });
    });
    fileInput.setAttribute('accept', extensions.join(','));

    let navDevice = null;

    /** The rail only lists the views of the loaded device type. */
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

      const device = RouterLens.devices.get(state.device);
      const available = deviceViews();
      const view = available.find(function (v) { return v.id === state.viewId; }) || available[0];
      if (!view) {
        title.textContent = 'RouterLens';
        main.appendChild(ui.emptyNote('No views are available for ' + device.label + ' yet.'));
        return;
      }
      const hostname = device.hostname ? device.hostname(state.config) : null;
      const warnings = state.config.warnings || [];
      title.textContent = view.label;
      meta.replaceChildren.apply(meta, [
        hostname ? h('span', { class: 'meta-host' }, hostname) : null,
        h('span', { class: 'meta-file', title: device.label + ' · ' + state.fileName }, state.fileName),
        warnings.length
          ? h('span', { class: 'meta-warn', title: warnings.map(function (w) { return 'Line ' + w.line + ': ' + w.message + ' (' + w.text + ')'; }).join('\n') },
            warnings.length + ' parser warning' + (warnings.length > 1 ? 's' : ''))
          : null,
      ].filter(Boolean));

      main.appendChild(view.render(state.config, { sub: subFromHash() }));
      document.title = (hostname ? hostname + ' · ' : '') + view.label + ' · RouterLens';
    }

    function fileList() {
      const labels = devices.map(function (d) { return d.fileLabel || d.label; });
      if (labels.length < 2) return labels.join('');
      return labels.slice(0, -1).join(', ') + ' or ' + labels[labels.length - 1];
    }

    function emptyState() {
      return h('div', { class: 'empty-state' },
        h('div', { class: 'dropzone' },
          h('div', { class: 'dropzone-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>' }),
          h('h1', null, 'Open a device config export'),
          h('p', null, 'Drop ' + fileList() + ' here or choose it from disk.'),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: function () { fileInput.click(); } }, 'Choose file'),
          h('p', { class: 'privacy' }, 'The file is parsed locally in your browser and is never uploaded.')));
    }

    render();
  };
})(window);
