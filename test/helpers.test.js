const assert = require('node:assert/strict');

const {
  createImageFileName,
  formatImageReference,
  normalizeImageDirectory,
  normalizeWorkspacePath,
  shouldSendToTerminal
} = require('../dist/helpers');

assert.equal(normalizeWorkspacePath('src\\extension.ts'), 'src/extension.ts');
assert.equal(normalizeImageDirectory(' /tmp/images/ '), 'tmp/images');
assert.equal(normalizeImageDirectory(''), '.images');

assert.equal(
  createImageFileName(new Date('2026-07-03T17:30:25.123Z')),
  '2026-07-03T17-30-25-123Z.png'
);

assert.equal(formatImageReference('.images/paste.png', 'atPath'), '@.images/paste.png');
assert.equal(formatImageReference('.images/paste.png', 'path'), '.images/paste.png');

assert.equal(shouldSendToTerminal('copyAndPaste', true), true);
assert.equal(shouldSendToTerminal('copyAndPaste', false), false);
assert.equal(shouldSendToTerminal('copyOnly', true), false);

console.log('helper tests passed');
