'use strict';

const pdfParse = require('pdf-parse');
const { parseHspkText } = require('./textStateParser');

/**
 * @param {Buffer} fileBuffer isi file PDF
 * @returns {Promise<{materials, jobs, issues}>}
 */
async function parsePdfBuffer(fileBuffer) {
  const data = await pdfParse(fileBuffer);
  return parseHspkText(data.text);
}

module.exports = { parsePdfBuffer };
