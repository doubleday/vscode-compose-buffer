const assert = require('node:assert/strict');

const {
  createImageFileName,
  formatPathTail,
  formatImageReference,
  normalizeImageDirectory,
  normalizeWorkspacePath,
  shouldSendToTerminal
} = require('../dist/helpers');
const {
  createPathIndex,
  getShortestUniquePathSuffix,
  parsePathCompletionQuery,
  searchPathIndex,
  searchPathIndexWithTypes
} = require('../dist/pathIndex');
const {
  dedupeAgentCompletions,
  getAgentCompletionMatchScore,
  getFuzzyMatchScore,
  normalizeAgentCompletions
} = require('../dist/agentCompletions');

assert.deepEqual(
  normalizeAgentCompletions([' review ', '/deploy', '$skill'], '$'),
  [
    { alias: '$review', insertText: '$review' },
    { alias: '$skill', insertText: '$skill' }
  ]
);
assert.deepEqual(
  normalizeAgentCompletions({ rev: ['review', '$review'], '/ship': '/deploy' }, '/'),
  [
    { alias: '/rev', insertText: '/review' },
    { alias: '/ship', insertText: '/deploy' }
  ]
);
assert.deepEqual(
  dedupeAgentCompletions([
    { alias: '$review', insertText: '$review' },
    { alias: '$review', insertText: '$review' },
    { alias: '$review', insertText: '$review-code' }
  ]),
  [
    { alias: '$review', insertText: '$review' },
    { alias: '$review', insertText: '$review-code' }
  ]
);
assert.equal(getFuzzyMatchScore('rev', 'review'), 3);
assert.equal(getFuzzyMatchScore('view', 'review'), 52);
assert.equal(getFuzzyMatchScore('rvw', 'review'), 103);
assert.equal(getFuzzyMatchScore('xyz', 'review'), undefined);
assert.equal(
  getAgentCompletionMatchScore('deploy', { alias: '/ship', insertText: '/deploy-production' }),
  10
);

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

assert.equal(formatPathTail('openspec/changes/add-billing/', 40), 'openspec/changes/add-billing');
assert.equal(
  formatPathTail('test/assets/path-completions/openspec/changes/add-billing/', 28),
  '...nspec/changes/add-billing'
);

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
    'src/features/auth',
    'src/features/auth/LoginController.ts'
  ]
);
assert.deepEqual(
  searchPathIndex(pathIndex, parsePathCompletionQuery('openspec/changes/add-login/'), 10),
  ['openspec/changes/add-login/plan.md']
);
assert.deepEqual(
  searchPathIndexWithTypes(pathIndex, parsePathCompletionQuery('openspec/ch'), 10).slice(0, 2),
  [
    { path: 'openspec/changes', isDirectory: true },
    { path: 'openspec/changes/add-login', isDirectory: true }
  ]
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

const namingStyleIndex = createPathIndex([
  'src/differential-pipeline-wrapper.ts',
  'src/DifferentialPipelineWrapper.ts'
]);

for (const query of ['f:dpw', 'f:DPW', 'f:DiPiW']) {
  assert.deepEqual(
    searchPathIndex(namingStyleIndex, parsePathCompletionQuery(query), 10).slice(0, 2),
    [
      'src/DifferentialPipelineWrapper.ts',
      'src/differential-pipeline-wrapper.ts'
    ]
  );
}

assert.deepEqual(
  searchPathIndex(namingStyleIndex, parsePathCompletionQuery('dpw'), 10),
  [
    'src/DifferentialPipelineWrapper.ts',
    'src/differential-pipeline-wrapper.ts'
  ]
);

const structuredPathIndex = createPathIndex([
  'first/second/third.md',
  'first/something-deep/third.md'
]);

assert.deepEqual(
  searchPathIndex(structuredPathIndex, parsePathCompletionQuery('/fi/sd/t'), 10),
  [
    'first/something-deep/third.md',
    'first/second/third.md'
  ]
);

assert.deepEqual(
  searchPathIndex(structuredPathIndex, parsePathCompletionQuery('/fi/missing/t'), 10),
  []
);

const mixedPathResults = searchPathIndexWithTypes(
  createPathIndex([
    'openspec/changes/add-billing/proposal.md',
    'openspec/changes/add-billing/plan.md',
    '.images/ab-archive.png'
  ]),
  parsePathCompletionQuery('ab'),
  10
);
assert.deepEqual(
  mixedPathResults.slice(0, 4),
  [
    { path: 'openspec/changes/add-billing', isDirectory: true },
    { path: '.images/ab-archive.png', isDirectory: false },
    { path: 'openspec/changes/add-billing/plan.md', isDirectory: false },
    { path: 'openspec/changes/add-billing/proposal.md', isDirectory: false }
  ]
);

assert.deepEqual(
  searchPathIndexWithTypes(
    createPathIndex(['add-billing.md', 'add-billing/child.txt']),
    parsePathCompletionQuery('ab'),
    2
  ),
  [
    { path: 'add-billing.md', isDirectory: false },
    { path: 'add-billing', isDirectory: true }
  ]
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
