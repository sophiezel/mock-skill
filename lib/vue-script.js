'use strict';

/**
 * Extract <script> / <script setup> blocks from a Vue SFC source string.
 * Returns an array of { lang, content } — one entry per script block.
 * Does NOT parse <template>; does NOT resolve external src="..." scripts.
 *
 * Lightweight regex-based extraction: avoids pulling in @vue/compiler-sfc.
 */

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * @param {string} source - full .vue file content
 * @returns {Array<{ lang: string, content: string }>}
 */
function extractVueScriptBlocks(source) {
  const blocks = [];
  if (!source || typeof source !== 'string') return blocks;
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(source))) {
    const attrs = m[1] || '';
    const content = m[2] || '';
    const langM = /\blang\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    const lang = langM ? langM[1].toLowerCase() : 'js';
    // Normalise: ts / tsx → ts; js / jsx → js
    const norm = lang === 'ts' || lang === 'tsx' ? 'ts' : 'js';
    blocks.push({ lang: norm, content });
  }
  return blocks;
}

/**
 * Build a virtual source file path for a .vue file's script block.
 * e.g. src/pages/Foo.vue → src/pages/Foo.vue.__script0.js
 *
 * @param {string} vueRelPath - project-relative path of the .vue file
 * @param {number} index - script block index (0-based)
 * @param {string} lang - 'js' or 'ts'
 * @returns {string}
 */
function virtualScriptPath(vueRelPath, index, lang) {
  const ext = lang === 'ts' ? 'ts' : 'js';
  return `${vueRelPath}.__script${index}.${ext}`;
}

module.exports = { extractVueScriptBlocks, virtualScriptPath };
