# CLAUDE.md

## Git workflow

- `develop` is the working branch. Never commit directly to `develop` or `main`.
- Every change goes into its own feature branch created from `develop`, finished with a PR **into `develop`**.
- `main` only receives releases (merge `develop` → `main`) when explicitly requested by the maintainer.

## Project

- Plain HTML/CSS/JS, no framework, no build step, no backend. See `PROJECT_SPEC.md` and `README.md`.
- Config data must never leave the browser (no network requests).
- All source code, comments, docs and UI texts in English.
- Tests: `npm test` (parsers, `node:test`).

## Modular structure (mandatory)

Every supported device type (vendor / product family) is a self-contained module. The core must
stay device-agnostic.

- `js/core/` – shell, device + view registries (`app.js`), shared DOM helpers (`ui.js`).
  No vendor-specific code here.
- `js/devices/<id>/` – one folder per device type (`insys`, `securepoint`, `wago-switch`, …):
  - `device.js` registers the type via `RouterLens.devices.register({ id, label, fileLabel, extensions, binary?, open, hostname? })`.
    `open()` returns parsed data, or `null` if the file is not this type's format, so detection never relies on the extension alone.
  - `parser.js` – pure parsing, browser global + `module.exports` for tests.
  - optional `ui.js` with helpers shared by this device's views.
  - `views/*.js` – each calls `RouterLens.views.register({ ..., device: '<id>' })` (`device` is required).
- `css/app.css` holds shared components only; device-specific styles go to `css/devices/<id>.css`.
- Sample files go to `reference/<id>/` (anonymized), tests to `tests/<id>.test.js`.
- Model differences within one device type (port layout, features) are handled inside the module,
  not by a new module.
- A new device = new folder + script/style tags in `index.html`; no changes in other device modules.
