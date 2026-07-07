const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'test', 'assets', 'path-completions');
  const target = path.join(root, '.debug', 'fixture-workspace');

  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, target, { recursive: true });

  console.log(`Prepared fixture workspace: ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
