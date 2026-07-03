# VS Code Compose Buffer Extension Plan

Status: Proposed
Date: 2026-07-03

## Summary

Build a VS Code extension that gives terminal-based coding agents a proper compose buffer: users open a temporary native editor, write with normal VS Code editing UX, reference files with `@`, paste images into a workspace `.images` folder, then commit the composed text back to the terminal and clipboard.

This should use a native VS Code editor rather than a true terminal overlay. VS Code exposes stable APIs for remembering the active terminal, opening editable documents, completion providers, paste providers, clipboard writes, and terminal input. It does not provide a stable API for drawing arbitrary UI on top of the integrated terminal.

## Key Changes

- Scaffold a new TypeScript VS Code extension in this workspace.
- Add commands:
  - `composeBuffer.open`: opens or reveals a temporary compose editor and captures `window.activeTerminal`.
  - `composeBuffer.commit`: reads the editor text, writes it to the clipboard, reveals the captured terminal, and sends the text with `sendText(text, false)`.
  - `composeBuffer.copyOnly`: copies the buffer without terminal send.
  - `composeBuffer.cancel`: closes the buffer without copying.
- Use a normal VS Code editor document for proper editing UX, with `Esc` and `Ctrl+Enter` bound to commit only while the compose buffer is active.
- Track the last focused terminal via `window.activeTerminal` and terminal change events. If the terminal is gone, fall back to clipboard only.
- Register `@` completions for workspace files, inserting refs like `@src/file.ts`.
- Handle pasted images with a document paste provider:
  - Save images into `.images/`.
  - Prefer terminal cwd when VS Code shell integration exposes a workspace-local cwd; otherwise use the workspace root.
  - Insert `@.images/<timestamp>.png`.
- Add settings:
  - `composeBuffer.commitBehavior`: default `copyAndPaste`.
  - `composeBuffer.imageDirectory`: default `.images`.
  - `composeBuffer.imageReferenceStyle`: default `atPath`.

## API Basis

- VS Code exposes the current or most recent terminal via `window.activeTerminal`.
- Terminals can be revealed and sent text without executing it using `Terminal.show()` and `Terminal.sendText(text, false)`.
- Clipboard writes are supported through `env.clipboard.writeText`.
- `@` suggestions can use `registerCompletionItemProvider` with trigger characters.
- Image paste can be handled through `registerDocumentPasteEditProvider` and paste MIME metadata.

## Test Plan

- Unit-test path formatting, image filename generation, and terminal fallback behavior.
- Extension-test opening the buffer, committing text, clipboard write behavior, `@` completions, and image paste insertion.
- Manually verify with Claude, Cursor CLI, and Codex TUIs in VS Code terminals:
  - Open the compose buffer.
  - Edit with normal selection keys.
  - Paste an image.
  - Press `Esc`.
  - Confirm content lands in the terminal and remains in clipboard.

## Assumptions

- Default surface is the native VS Code editor, not a custom webview.
- Commit default is copy plus terminal paste/send.
- Image references default to `@path`.
- Docker sandbox agents can read `.images` because the workspace is mounted into the container; otherwise the extension can only create the host-side file reference.
