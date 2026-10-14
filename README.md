# RouterLens

**➡️ [Open the live app](https://a-denisov-psb.github.io/routerlens/)**

Renders router configuration exports as a readable, GUI-like web view. Two router types are
supported: **INSYS icom OS** (flat `key=value` export, `.txt`) and **Securepoint UTM** (the PDF
report, `.pdf`). The type is chosen by the file extension. It is a **documentation tool** for maintenance work –
not a management portal: there is no connection to the router and no backend.

## Privacy

Config exports contain plaintext passwords, certificates and private keys. RouterLens
parses the file **locally in the browser**; nothing is uploaded. Network requests from
scripts are blocked via Content Security Policy (`connect-src 'none'`).

## Usage

No build step, no dependencies.

1. Open `index.html` in a browser (double-click works), or serve the folder locally:
   ```
   python3 -m http.server 8000
   ```
   and open <http://localhost:8000>.
2. Drop the exported config file (INSYS `.txt`) or the Securepoint report (`.pdf`) onto the
   page or use **Open file…**.

Sample files: `reference/example_config.txt` (INSYS) and
`reference/securepoint_example_report.pdf` (Securepoint, anonymized).

## Scope

| View | Status | Content |
|---|---|---|
| Dashboard | ✅ | System (hostname, domain, location, device note), firewall status, port → network assignment, cards for IP networks (addresses, DHCP client/server, VLAN, MTU, ports), WAN chains and mobile interfaces, VPN tunnels (IPsec, OpenVPN, GRE, DMVPN, PPTP, PPPoE) |
| Firewall | ✅ | IP filter rule table (direction icons, protocol badges, per-row detail panel, per-column filters, full-text search incl. hidden fields), plus Source NAT and Destination NAT rule tables below it with the same interaction |
| Routing | ✅ | Static routes and OpenVPN server routes (local + pushed to clients), each with a per-row detail panel |

Securepoint UTM reports have their own views (navigation shows only the loaded router type):

| View | Status | Content |
|---|---|---|
| Dashboard | ✅ | System (model, version, licensee, licence, serial number, name server, NTP), firewall figures, users with their groups, routes, one card per interface (addresses, zones, MAC, MTU, link, VLAN, dynamic DNS) |
| Users | ✅ | User groups with permission and members, full user table |
| Firewall → Rules | ✅ | Packet filter rules in their rule groups (collapsible, group active state, auto-generated badge), per-column filters, global search over everything a rule resolves to; the detail panel expands source, destination and service down to the members of their object/service groups (address, zone, protocol, ports) and shows NAT object, logging and comment |

Only configuration state is rendered. Runtime data (serial number, firmware, uptime,
online state, DHCP-assigned addresses) is not part of the export and is therefore not shown.
Secrets (passwords, PSKs, keys) are not rendered in the current views.

## Project structure

```
index.html            App shell (icon rail, top bar), script includes
css/app.css           Styles (light + dark via prefers-color-scheme)
js/parser.js          Config parser (browser global + CommonJS for tests)
js/ui.js              DOM helpers (cards, key/value lists, pills, chips)
js/app.js             View registry, navigation, file loading, router type detection
js/securepoint/       Securepoint report: PDF text extraction + table parser
js/vendor/pdfjs/      pdf.js 3.11.174 (Apache-2.0), loaded only when a PDF is opened
js/views/*.js         One file per navigation entry
tests/                Parser tests (node:test), fixtures
reference/            Example INSYS config + REST API spec (OpenAPI 9.5), anonymized Securepoint report
```

### Parser

`RouterLens.parser.parseConfig(text)` returns a `Config` object:

- `get('a.b[1].c')` – value of a flat key (icom text wrappers like
  `-----BEGIN device_note-----…-----END device_note-----` removed, PEM blocks kept)
- `node('interfaces.ip_nets')` – nested subtree
- `list('netfilter.ip_filter.rule')` – array entries, each with its 1-based `_index`
- `directives` – import instructions (`….delete=all`, `….add=N`), kept apart from values
- `warnings` – e.g. unterminated multi-line values, duplicate keys

Multi-line values are read up to their matching `-----END <label>-----` marker, so
continuation lines may contain `=` (base64 padding, bird config).

Field meanings follow the REST API schemas, e.g. `interfaces.ethernet1.*` ↔
`configuration.interfaces.ethernet1` in `reference/icomOS_REST_API_9.5.json`.

### Securepoint report parser

The Securepoint report has no machine-readable export, only a PDF with tables. Reading it
is done in two steps (both local, no network):

1. `RouterLens.securepointPdf.extractPages(pdfjsLib, buffer)` extracts the text with pdf.js and
   returns pages → lines → cells `{ x, text }`. The x position is kept because empty table
   cells do not exist in plain text.
2. `RouterLens.securepoint.parseReport(pages)` reads every table of the table of contents,
   assigns the cells to the columns of the table header by their x position and returns the
   report model: `system`, `users`, `interfaces` (with addresses), `routes`, `zones`, `nodes`,
   `nodeGroups`, `services`, `serviceGroups`, `ruleGroups` (each with its `rules`), `globals`
   and `applications`. `resolveEndpoint(name)` / `resolveService(name)` expand a rule's
   source/destination/service name to the node or service (group) with all members.

`RouterLens.securepoint.detect(pages)` verifies that a PDF really is a Securepoint UTM report
(title on page 1, table of contents with "System info").

### Adding a view

Create `js/views/<name>.js` and include it in `index.html` after `js/app.js`:

```js
RouterLens.views.register({
  id: 'routing',              // URL hash (#routing)
  label: 'Routing',           // tooltip / page title
  icon: '<svg …>…</svg>',     // 24×24 stroke icon
  device: 'insys',            // router type: 'insys' (default) or 'securepoint'
  render: function (config) { return RouterLens.ui.h('div', null, '…'); },
});
```

## Tests

```
npm test
```
