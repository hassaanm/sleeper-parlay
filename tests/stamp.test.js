// The asset stamps in index.html must match the files (run `npm run stamp`), and
// 404.html must be an exact copy. See scripts/stamp.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stampedIndex } from '../scripts/stamp.js';

test('index.html asset stamps are current (run npm run stamp)', () => {
  assert.equal(readFileSync('index.html', 'utf8'), stampedIndex());
});

test('404.html is a copy of index.html (run npm run stamp)', () => {
  assert.equal(readFileSync('404.html', 'utf8'), readFileSync('index.html', 'utf8'));
});
