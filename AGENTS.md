# Repository Guidelines

## Project Structure & Module Organization

This repository contains a small VS Code extension for a native compose buffer. Source code lives in `src/`: `extension.ts` wires VS Code commands and providers, while `helpers.ts` and `pathIndex.ts` hold testable utility logic. Compiled CommonJS output is written to `dist/` by TypeScript and is required by the current test runner, but should be treated as build output. Tests live in `test/`, with `test/helpers.test.js` covering compiled helper modules and `test/assets/path-completions/` providing fixture paths. Documentation and design notes are under `docs/`; `scripts/prepare-fixture-workspace.js` supports local extension debugging fixtures.

## Build, Test, and Development Commands

- `npm install`: install TypeScript, VS Code types, and other development dependencies.
- `npm run compile`: run `tsc -p ./` and emit extension code into `dist/`.
- `npm run check`: compile, then run `node test/helpers.test.js`.
- `npm run install:local`: run checks, package a local `.vsix`, and install it into VS Code.

Use `npm run check` before handing off changes. Run `Compose Buffer: Rebuild File Index` manually in VS Code after fixture or path-indexing changes.

## Coding Style & Naming Conventions

The project uses TypeScript with `strict` mode, CommonJS modules, ES2022 target, and two-space indentation. Prefer small exported helpers for behavior that can be tested from Node without launching VS Code. Use camelCase for functions and variables, PascalCase for types/interfaces, and descriptive command/configuration IDs under the `composeBuffer.*` namespace. Keep path handling normalized to workspace-relative forward-slash paths.

## Testing Guidelines

Tests currently use Node's built-in `assert/strict` module rather than a full framework. Add focused assertions to `test/helpers.test.js` when changing helper or path-index logic. Because tests import from `dist/`, always compile before running them; `npm run check` does this for you. Name future test files with a `.test.js` suffix and keep reusable sample files under `test/assets/`.

## Commit & Pull Request Guidelines

Recent history uses concise, imperative commit messages such as `Improve compose path completions`, with occasional scoped documentation commits like `docs: explain agent completion configuration`. Keep commits focused and mention the user-visible behavior when applicable. Pull requests should include a short summary, test results such as `npm run check`, linked issues when relevant, and screenshots or screen recordings for visible VS Code UI changes.

## Security & Configuration Tips

Do not commit local `.vsix` packages, generated image directories, or user workspace data. When adding settings, document defaults in `package.json` and mirror user-facing behavior in `README.md` or `docs/`.
