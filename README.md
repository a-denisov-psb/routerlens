# RouterLens

**➡️ [Open the live app](https://a-denisov-psb.github.io/routerlens/)**

Renders router and switch configuration exports as a readable, GUI-like web view. Supported
device types:

- **INSYS icom OS** routers – flat `key=value` export (`.txt`)
- **Securepoint UTM** firewalls – the PDF configuration report (`.pdf`)
- **WAGO managed switches** (852 series) – the CLI export `config.save`

The device type is recognized from the file content (the extension only narrows the candidates).
It is a **documentation tool** for maintenance work – not a management portal: there is no
connection to the device and no backend.

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
2. Drop the exported config file (INSYS `.txt`, WAGO `config.save`) or the Securepoint report
   (`.pdf`) onto the page or use **Open file…**.

Sample files (anonymized): `reference/insys/example_config.txt`,
`reference/securepoint/example_report.pdf`, `reference/wago-switch/example_config.save`.

## Scope

Every device type has its own views (navigation shows only the loaded type).

**INSYS icom OS:**

| View | Status | Content |
|---|---|---|
| Dashboard | ✅ | System (hostname, domain, location, device note), firewall status, port → network assignment, cards for IP networks (addresses, DHCP client/server, VLAN, MTU, ports), WAN chains and mobile interfaces, VPN tunnels (IPsec, OpenVPN, GRE, DMVPN, PPTP, PPPoE) |
| Firewall | ✅ | IP filter rule table (direction icons, protocol badges, per-row detail panel, per-column filters, full-text search incl. hidden fields), plus Source NAT and Destination NAT rule tables below it with the same interaction |
| Routing | ✅ | Static routes and OpenVPN server routes (local + pushed to clients), each with a per-row detail panel |

**Securepoint UTM:**

| View | Status | Content |
|---|---|---|
| Dashboard | ✅ | System (model, version, licensee, licence, serial number, name server, NTP), firewall figures, users with their groups, routes, one card per interface (addresses, zones, MAC, MTU, link, VLAN, dynamic DNS) |
| Users | ✅ | User groups with permission and members, full user table |
| Firewall → Rules | ✅ | Packet filter rules in their rule groups (collapsible, group active state, auto-generated badge), per-column filters, global search over everything a rule resolves to; the detail panel expands source, destination and service down to the members of their object/service groups (address, zone, protocol, ports) and shows NAT object, logging and comment |
| Firewall → Network objects | ✅ | Network groups with their members next to all network objects (type, address, zone, containing groups, number of rules using them); GeoIP country objects are hidden until ticked. Master-detail: selecting a group lists only its members, selecting an object lists only the groups containing it (deselect by clicking the row again, the × chip, Escape or the empty background); search fields keep working on top |
| Firewall → Services | ✅ | Service groups with their members next to all services (protocol, ports, ICMP types, source ports, containing groups, rules using them) |

**WAGO managed switch:**

| View | Status | Content |
|---|---|---|
| Dashboard | ✅ | System (model, management address and gateway, PROFINET / LLDP), MRP ring redundancy (state, ring ports, ring VLAN), VLAN overview, front panel with PVID / tagged VLANs / ring / frame-type hints per port, and every statement the parser does not interpret ("Other settings") |
| VLANs | ✅ | Membership matrix VLAN × port (untagged, tagged, forbidden, PVID marked) and per-port VLAN settings (PVID, untagged / tagged VLANs, accepted frame types, warning when the PVID is not an untagged VLAN of the port) |

Only configuration state is rendered. Runtime data (serial number, firmware, uptime,
online state, DHCP-assigned addresses) is not part of the export and is therefore not shown.
Secrets (passwords, PSKs, keys) are not rendered in the current views.

## Project structure

```
index.html                  App shell (icon rail, top bar), script and style includes
css/app.css                 Shared styles (light + dark), shared components
css/devices/<id>.css        Styles only one device type uses
js/core/app.js              Device + view registries, navigation, file loading
js/core/ui.js               DOM helpers (cards, key/value lists, pills, chips)
js/devices/<id>/            One self-contained module per device type:
  device.js                   registration (file types, recognition, top bar name)
  parser.js                   parser (browser global + CommonJS for tests)
  ui.js                       helpers shared by the module's views (optional)
  views/*.js                  one file per navigation entry
js/lib/pdfjs/               pdf.js 3.11.174 (Apache-2.0), loaded only when a PDF is opened
tests/<id>.test.js          Parser tests (node:test), fixtures
reference/<id>/             Anonymized sample files, specs
```

Device modules: `insys` (INSYS icom OS), `securepoint` (Securepoint UTM), `wago-switch`
(WAGO 852 managed switches).

### INSYS parser

`RouterLens.insys.parseConfig(text)` returns a `Config` object:

- `get('a.b[1].c')` – value of a flat key (icom text wrappers like
  `-----BEGIN device_note-----…-----END device_note-----` removed, PEM blocks kept)
- `node('interfaces.ip_nets')` – nested subtree
- `list('netfilter.ip_filter.rule')` – array entries, each with its 1-based `_index`
- `directives` – import instructions (`….delete=all`, `….add=N`), kept apart from values
- `warnings` – e.g. unterminated multi-line values, duplicate keys

Multi-line values are read up to their matching `-----END <label>-----` marker, so
continuation lines may contain `=` (base64 padding, bird config).

Field meanings follow the REST API schemas, e.g. `interfaces.ethernet1.*` ↔
`configuration.interfaces.ethernet1` in `reference/insys/icomOS_REST_API_9.5.json`.

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

### WAGO switch parser

The 852 managed switches save their configuration as `config.save`: the CLI statements of the
running configuration, without indentation. There is no published description of the file
itself; the statements are the CLI commands from the WAGO 852 manuals (VLAN, port and ring
settings). Blocks start with `vlan <id>`, `interface <name>` or `mrp ring-id <id>` and end with
`!`; everything else is a global statement.

| Statement | Meaning |
|---|---|
| `vlan 3` / `name …` | VLAN ID and name |
| `fixed 4,9` | VLAN member ports (port lists use ranges: `1-8,10`) |
| `tagged 4` | Members that send this VLAN tagged; the other members send it untagged |
| `untagged …` / `forbidden …` | Explicit untagged members / ports excluded from the VLAN |
| `interface fastethernet1/0/9` | Port 9 (`gigabitethernet…` for gigabit / SFP ports, `eth0` = management) |
| `pvid 3` | VLAN of untagged frames received on the port (default 1) |
| `acceptable frame type untagged` | `all` (default), `tagged` or `untagged` frames accepted |
| `ip address …/24`, `ip address default-gateway …` | Management address (on `eth0`) |
| `mrp ring-id 1` … `ring enable`, `ring port-1 1`, `ring vlan 1` | MRP ring redundancy (`no ring enable` = disabled) |
| `profinet enable`, `lldp enable` | Protocol switches (`no … enable` = off) |
| `model-name 852-0603` | Item number; known models add the port media (copper / SFP) |

`RouterLens.wagoSwitch.parseConfig(text)` returns `model`, `features`, `vlans`, `interfaces`,
`management`, `rings`, `ports` (one entry per port with its effective PVID, untagged and tagged
VLANs, accepted frames, ring membership) and `warnings`. Statements it does not interpret are kept
in `other` / `otherGlobals` and shown in the dashboard.

### Adding a device type

1. Create `js/devices/<id>/` with `device.js`, `parser.js` and `views/*.js` (see existing modules),
   optional `css/devices/<id>.css`, a sample in `reference/<id>/` and `tests/<id>.test.js`.
2. Include the scripts (and stylesheet) in `index.html`.

```js
RouterLens.devices.register({
  id: 'acme',
  label: 'ACME router',
  fileLabel: 'an ACME export (.cfg)',   // start page text
  extensions: ['.cfg'],                 // candidates; content decides
  binary: false,                        // true: open() gets an ArrayBuffer
  open: function (text, file) { return looksLikeAcme(text) ? parse(text) : null; },
  hostname: function (data) { return data.hostname; },
});

RouterLens.views.register({
  id: 'dashboard',            // URL hash (#dashboard)
  label: 'Dashboard',         // tooltip / page title
  icon: '<svg …>…</svg>',     // 24×24 stroke icon
  device: 'acme',             // required: the device type the view belongs to
  render: function (data, ctx) { return RouterLens.ui.h('div', null, '…'); },
});
```

## Tests

```
npm test
```
