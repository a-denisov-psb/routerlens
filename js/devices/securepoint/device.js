/*
 * Device module: Securepoint UTM firewalls (PDF configuration report).
 * pdf.js is large and only needed here, so it is loaded on first use.
 * Parser: ./pdf-extract.js + ./parser.js (RouterLens.securepoint), views: ./views/*.js (device 'securepoint').
 */
(function (root) {
  'use strict';

  const RouterLens = root.RouterLens;
  const PDFJS_DIR = 'js/lib/pdfjs/';

  function loadPdfjs() {
    return RouterLens.loadScript(PDFJS_DIR + 'pdf.min.js').then(function () {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + 'pdf.worker.min.js';
      return root.pdfjsLib;
    });
  }

  /** PDF files start with "%PDF". */
  function isPdf(buffer) {
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    return String.fromCharCode.apply(null, head) === '%PDF';
  }

  RouterLens.devices.register({
    id: 'securepoint',
    label: 'Securepoint UTM',
    fileLabel: 'a Securepoint UTM report (.pdf)',
    extensions: ['.pdf'],
    binary: true,
    open: async function (buffer, file) {
      if (!isPdf(buffer)) return null;
      const pdfjs = await loadPdfjs();
      let pages;
      try {
        pages = await RouterLens.securepointPdf.extractPages(pdfjs, buffer);
      } catch (err) {
        throw new Error('Could not read "' + file.name + '" as a PDF: ' + err.message);
      }
      return RouterLens.securepoint.detect(pages) ? RouterLens.securepoint.parseReport(pages) : null;
    },
    hostname: function (report) { return report.system.hostname; },
  });
})(window);
