const assert = require('node:assert/strict');

const {
  createImageFileName,
  formatImageReference,
  normalizeImageDirectory,
  normalizeWorkspacePath,
  shouldSendToTerminal
} = require('../dist/helpers');
const {
  createPathIndex,
  getShortestUniquePathSuffix,
  parsePathCompletionQuery,
  searchPathIndex
} = require('../dist/pathIndex');

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

const pathIndex = createPathIndex([
  'openspec/changes/add-login/plan.md',
  'openspec/specs/auth/plan.md',
  '.images/2026-07-06T08-00-21-566Z.png',
  '.images/2026-07-06T08-31-31-779Z.png',
  'src/features/auth/LoginController.ts',
  'src/features/auth/LoginControllerTest.ts',
  'src/features/billing/InvoiceService.ts',
  'src/extension.ts'
]);

assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('src/features/auth'), 10).slice(0, 2),
  [
    'src/features/auth/LoginController.ts',
    'src/features/auth/LoginControllerTest.ts'
  ]
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('openspec/changes/add-login/'), 10),
  ['openspec/changes/add-login/plan.md']
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('sfa'), 10).slice(0, 2),
  [
    'src/features/auth/LoginController.ts',
    'src/features/auth/LoginControllerTest.ts'
  ]
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('f:lct'), 10).slice(0, 2),
  [
    'src/features/auth/LoginControllerTest.ts',
    'src/features/auth/LoginController.ts'
  ]
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('d:add'), 10),
  ['openspec/changes/add-login']
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('d:adlog'), 10),
  ['openspec/changes/add-login']
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('d:opadd'), 10),
  []
);
assert.equal(
  searchPathIndex(pathIndex, parsePathCompletionQuery('lctr'), 10)[0],
  'src/features/auth/LoginController.ts'
);
assert.equal(
  searchPathIndex(pathIndex, parsePathCompletionQuery('08-31'), 10)[0],
  '.images/2026-07-06T08-31-31-779Z.png'
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('2026'), 10).slice(0, 2),
  [
    '.images/2026-07-06T08-00-21-566Z.png',
    '.images/2026-07-06T08-31-31-779Z.png'
  ]
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('zz'), 10),
  []
);

const repeatedProposalPaths = [
  'test/assets/path-completions/openspec/changes/add-login/proposal.md',
  'test/assets/path-completions/openspec/changes/add-billing/proposal.md',
  'test/assets/path-completions/openspec/specs/auth/proposal.md'
];

assert.equal(
  getShortestUniquePathSuffix(
    'test/assets/path-completions/.images/2026-07-06T08-00-21-566Z.png',
    [
      'test/assets/path-completions/.images/2026-07-06T08-00-21-566Z.png',
      'test/assets/path-completions/.images/2026-07-06T08-12-44-122Z.png'
    ]
  ),
  '2026-07-06T08-00-21-566Z.png'
);
assert.equal(
  getShortestUniquePathSuffix(repeatedProposalPaths[0], repeatedProposalPaths),
  'add-login/proposal.md'
);
assert.equal(
  getShortestUniquePathSuffix(repeatedProposalPaths[2], repeatedProposalPaths),
  'auth/proposal.md'
);

console.log('helper tests passed');
