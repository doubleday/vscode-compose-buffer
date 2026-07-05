# Configure Compose Buffer Agent Completions

Use this document when an in-project coding agent should update VS Code settings so Compose Buffer can suggest that agent's known invocations.

## What Compose Buffer Expects

Compose Buffer reads one VS Code setting:

```json
"composeBuffer.agentCompletions": []
```

This setting controls completions inside a Compose Buffer editor:

- Typing `$` suggests entries whose configured insertion text starts with `$`.
- Typing `/` suggests entries whose configured insertion text starts with `/`.
- Typing more characters fuzzy-filters the suggestions.

The meaning of each prefix is agent-specific. Codex uses `$` for skills. Other agents generally expose their reusable actions, skills, prompts, or commands through `/`.

The setting can be placed in workspace settings:

```text
.vscode/settings.json
```

If that file does not exist, create it. If it already exists, preserve all existing settings and only add or update `composeBuffer.agentCompletions`.

## Your Task

Inspect your own available capabilities, then update `.vscode/settings.json` with completions that match what you actually support.

Include:

- Codex skills as `$SkillName`, when configuring Codex.
- Other agents' supported invocations as `/command`, or whatever slash form that agent expects.
- Only items that are useful for the user to trigger from a Compose Buffer.
- Stable names exactly as the agent expects them to be invoked.

Do not invent completions for capabilities you do not actually support.

## Preferred Format

Use a simple array unless aliases are specifically useful:

```json
{
  "composeBuffer.agentCompletions": [
    "$Excel",
    "$PowerPoint",
    "$openai-docs",
    "$plugin-creator",
    "$skill-creator",
    "/review",
    "/model",
    "/init"
  ]
}
```

Entries may include either `$` or `/`. Compose Buffer uses the prefix to decide whether the item appears after `$` or after `/`; it does not assign semantics beyond that.

## Alias Format

If short aliases would materially help, use an object instead:

```json
{
  "composeBuffer.agentCompletions": {
    "slides": "$PowerPoint",
    "docs": "$openai-docs",
    "fix": [
      "$skill-creator",
      "$plugin-creator"
    ],
    "review": "/review",
    "model": "/model"
  }
}
```

With aliases, the key is what appears in the suggestion list, and the value is what gets inserted.

Use aliases sparingly. Prefer the simple array when the canonical names are already readable.

## How To Edit Settings Safely

1. Open or create `.vscode/settings.json`.
2. Parse it as JSON with comments if your tooling supports VS Code settings syntax.
3. Preserve all unrelated settings.
4. Add or replace only `composeBuffer.agentCompletions`.
5. Keep the file valid JSON or valid VS Code JSON-with-comments.
6. Do not modify user-level settings unless the user explicitly asks for that.

If `.vscode/settings.json` is empty or missing, this minimal file is valid:

```json
{
  "composeBuffer.agentCompletions": [
    "$CodexSkillIfApplicable",
    "/agent-command"
  ]
}
```

Replace the example entries with real capabilities.

## Selection Guidance

Good entries:

- Real installed Codex skills, when the agent is Codex.
- Common review, planning, debugging, documentation, or mode-selection slash invocations supported by the configured agent.
- Capabilities the user is likely to use repeatedly from a compose prompt.

Avoid:

- Internal implementation details.
- One-off commands.
- Duplicate aliases for the same thing unless they are genuinely helpful.
- Commands requiring a different environment than this project provides.

## Verification

After updating settings:

1. Confirm `.vscode/settings.json` parses.
2. Open a Compose Buffer in VS Code.
3. If `$` entries were configured, type `$` and confirm those completions appear.
4. If `/` entries were configured, type `/` and confirm those completions appear.
5. Type a partial query, such as `$doc` or `/rev`, and confirm fuzzy filtering works for the configured entries.

No extension code changes are needed for this task. The completion feature already exists; this task is only about configuring the setting.
