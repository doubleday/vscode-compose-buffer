const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  label: 'integration',
  files: 'test/integration/**/*.test.js',
  workspaceFolder: 'test/fixtures/integration',
  mocha: {
    reporter: 'spec',
    timeout: 20_000
  }
});
