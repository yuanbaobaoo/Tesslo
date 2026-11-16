import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeFileName } from '../apps/tesslo/entry/src/main/ets/common/FileName.ts';

test('keeps a normal sb3 file name', () => {
  assert.equal(sanitizeFileName('Scratch作品.sb3'), 'Scratch作品.sb3');
});

test('replaces path separators and reserved characters', () => {
  assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j.sb3'), 'a_b_c_d_e_f_g_h_i_j.sb3');
});

test('strips surrounding spaces and falls back for empty names', () => {
  assert.equal(sanitizeFileName('   '), 'tesslo.sb3');
  assert.equal(sanitizeFileName(''), 'tesslo.sb3');
});

test('falls back for dot-only names that would resolve to a directory', () => {
  assert.equal(sanitizeFileName('.'), 'tesslo.sb3');
  assert.equal(sanitizeFileName('..'), 'tesslo.sb3');
});

test('keeps traversal text but removes the separators', () => {
  assert.equal(sanitizeFileName('../../evil.sb3'), '.._.._evil.sb3');
});
