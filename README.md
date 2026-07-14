# Compose Buffer

A minimal VS Code extension that opens a native editor as a compose buffer for terminal-based coding agents.

## Commands

- `Compose Buffer: Open` opens or reveals the buffer and captures the active terminal.
- `Compose Buffer: Restore Last Prompt` opens or reveals the buffer filled with the last committed or canceled prompt.
- `Compose Buffer: Restore Last Prompt From Terminal` sends `Ctrl+C` to the active terminal, then restores the last prompt.
- `Compose Buffer: Commit` copies the buffer to the clipboard and sends it to the captured terminal.
- `Compose Buffer: Copy Only` copies the buffer without sending it to a terminal.
- `Compose Buffer: Cancel` closes the buffer without copying.

While the compose buffer is active, `Ctrl+Enter` and `Esc` commit it. With terminal focus, `Ctrl+C` restores the last prompt unless terminal text is selected.

## Features

- `@` file completions insert workspace-relative references using a session-local file index.
- Plain `@` searches fuzzy matches across workspace-relative files and directories.
- `@f:` searches fuzzy matches on file names, and `@d:` searches fuzzy matches on directory names without matching across path separators.
- `$` and `/` completions can suggest configured agent skills or commands.
- Pasted images are written to `.images/` by default and inserted as `@.images/<timestamp>.png`.
- If shell integration exposes a workspace-local terminal cwd, pasted images are saved relative to that cwd.

## File References

Compose Buffer indexes workspace files the first time `@` completion is used. The index is kept in memory for the VS Code session. Run `Compose Buffer: Rebuild File Index` after large file moves, generated file changes, or branch switches.

Use the narrowest operator that matches what you know:

```text
@sfa            fuzzy search workspace-relative paths, such as src/features/auth
@f:lct          fuzzy search file names, such as LoginControllerTest
@d:add-login    fuzzy search directory names
```

Directory completions insert a trailing slash so you can continue narrowing, for example `@d:add-login` can insert `@openspec/changes/add-login/`, then you can type `plan` to complete `plan.md`.

See [Path Completion Ranking](docs/path-completion-ranking.md) for the matching and ordering specification.

Manual path-completion fixtures live under `test/assets/path-completions`. Try `@f:proposal` to test repeated OpenSpec-style filenames, or `@f:2026` to test timestamp-like image names.

## Settings

```json
"composeBuffer.agentCompletions": [
  "$Excel",
  "$PowerPoint",
  "$openai-docs",
  "$plugin-creator",
  "$skill-creator",
  "/review"
]
```

Typing `$` or `/` opens the configured completions for that prefix. Typing more characters fuzzy-filters the list, so `$ppt` can match `$PowerPoint` and `$pc` can match `$plugin-creator`.

Custom aliases are also supported:

```json
"composeBuffer.agentCompletions": {
  "slides": "$PowerPoint",
  "fix": [
    "$skill-creator",
    "$plugin-creator"
  ]
}
```

## Development

```sh
npm install
npm run check
```

## Install From GitHub Release

Download the `.vsix` file from the latest GitHub Release, then run:

```sh
code --install-extension compose-buffer-*.vsix
```
