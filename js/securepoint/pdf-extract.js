/*
 * Securepoint UTM report: PDF text extraction.
 *
 * Turns a PDF into pages of text lines. Every line is a list of cells
 * { x, end, text } sorted left to right, so the table parser can assign cells to
 * columns by their x position (empty cells are not representable in plain text).
 *
 * Needs pdf.js (global `pdfjsLib`, vendored in js/vendor/pdfjs). Everything runs locally.
 *
 * Runs in the browser (global `RouterLens.securepointPdf`) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const LINE_TOLERANCE = 2.5; // max y distance (pt) for items to share a line

  /**
   * Groups pdf.js text items of one page into lines of cells (pdf.js emits one item per table cell).
   * @param {Array<{str: string, transform: number[], width: number, height: number}>} items
   * @returns {Array<Array<{x: number, end: number, text: string}>>}
   */
  function itemsToLines(items) {
    const entries = items
      .filter(function (it) { return typeof it.str === 'string' && it.str.trim() !== ''; })
      .map(function (it) {
        return { x: it.transform[4], y: it.transform[5], w: it.width, text: it.str };
      })
      .sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    const rows = [];
    entries.forEach(function (e) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - e.y) <= LINE_TOLERANCE) row.items.push(e);
      else rows.push({ y: e.y, items: [e] });
    });

    return rows.map(function (row) {
      row.items.sort(function (a, b) { return a.x - b.x; });
      return row.items.map(function (e) { return { x: e.x, end: e.x + e.w, text: e.text.trim() }; });
    });
  }

  /**
   * @param {object} pdfjs The pdf.js library object.
   * @param {ArrayBuffer|Uint8Array} data
   * @returns {Promise<Array<Array<Array<{x: number, end: number, text: string}>>>>} pages -> lines -> cells
   */
  async function extractPages(pdfjs, data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(itemsToLines(content.items));
    }
    return pages;
  }

  const api = { extractPages: extractPages, itemsToLines: itemsToLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const RouterLens = (root.RouterLens = root.RouterLens || {});
  RouterLens.securepointPdf = api;
})(typeof window !== 'undefined' ? window : globalThis);
