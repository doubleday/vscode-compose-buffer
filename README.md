# Compose Buffer

A minimal VS Code extension that opens a native editor as a compose buffer for terminal-based coding agents.

## Commands

- `Compose Buffer: Open` opens or reveals the buffer and captures the active terminal.
- `Compose Buffer: Commit` copies the buffer to the clipboard and sends it to the captured terminal.
- `Compose Buffer: Copy Only` copies the buffer without sending it to a terminal.
- `Compose Buffer: Cancel` closes the buffer without copying.

While the compose buffer is active, `Ctrl+Enter` and `Esc` commit it.

## Features

- `@` file completions insert workspace-relative references.
- `$` and `/` completions can suggest configured agent skills or commands.
- Pasted images are written to `.images/` by default and inserted as `@.images/<timestamp>.png`.
- If shell integration exposes a workspace-local terminal cwd, pasted images are saved relative to that cwd.

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
