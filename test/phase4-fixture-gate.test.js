'use strict';

/**
 * Phase 4 — fixtures gate + de-branding guard.
 *
 * Asserts the engine (lib/ + scripts/) contains NO company-specific
 * domains / brand tokens. Company domains are allowed ONLY in test
 * fixtures (synthetic examples) and test assertions, never in the
 * product code path. This keeps the solution a generic, project-agnostic
 * product (per plan §5: "lib/scripts 无公司域名；无「必须先跑某仓」").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Company / brand domains that must NEVER appear in product code.
// (Sourced from the historical tower fixture; kept generic by matching
// the distinctive second-level labels, not full hostnames.)
const BRAND_PATTERNS = [
  /guazi/i,
  /chesupai/i,
  /guazi-cloud/i,
  /guazi-apps/i,
  /guazi-stage/i,
  /xuwei/i,
];

// Product code directories that must stay brand-free.
const PRODUCT_DIRS = ['lib', 'scripts', 'bin', 'runtime', 'adapters'];

// File extensions to scan.
const SCAN_EXT = new Set(['.js', '.json', '.ts', '.mjs', '.cjs']);

function* walk(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // skip node_modules / .data / .cursor / .git
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (e.isFile() && SCAN_EXT.has(path.extname(e.name))) {
      yield full;
    }
  }
}

function scanProductCode() {
  const offenders = [];
  for (const dir of PRODUCT_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const body = fs.readFileSync(file, 'utf8');
      for (const re of BRAND_PATTERNS) {
        if (re.test(body)) {
          offenders.push({ file: path.relative(ROOT, file), pattern: re.source });
        }
      }
    }
  }
  return offenders;
}

test('P4-BRAND1: lib/ scripts/ bin/ runtime/ adapters/ contain no company brand domains', () => {
  const offenders = scanProductCode();
  assert.deepEqual(
    offenders,
    [],
    `brand domains found in product code: ${JSON.stringify(offenders)}`,
  );
});

test('P4-FIX1: phase2 fixtures exist and are discoverable (declarative-grid, declarative-custom, props-drill)', () => {
  const expected = [
    'fixtures/declarative-grid-web/src/pages/itemsGridPage.js',
    'fixtures/declarative-custom-web/src/pages/tagsListPage.js',
    'fixtures/props-drill-web/src/pages/detailPage.js',
    'fixtures/props-drill-web/src/components/DetailCard.js',
  ];
  for (const rel of expected) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `missing fixture file: ${rel}`);
  }
});

test('P4-FIX2: phase2 fixtures use no UI-library brand imports (generic component names only)', () => {
  const files = [
    'fixtures/declarative-grid-web/src/pages/itemsGridPage.js',
    'fixtures/declarative-custom-web/src/pages/tagsListPage.js',
    'fixtures/props-drill-web/src/pages/detailPage.js',
    'fixtures/props-drill-web/src/components/DetailCard.js',
  ];
  for (const rel of files) {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/from ['"]antd|ant-design|@ant-design/i.test(body), `${rel} must not import a UI library`);
  }
});
