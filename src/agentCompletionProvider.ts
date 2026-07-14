import * as vscode from 'vscode';
import {
  AgentCompletion,
  AgentCompletionConfig,
  dedupeAgentCompletions,
  getAgentCompletionMatchScore,
  normalizeAgentCompletions
} from './agentCompletions';

type AgentCompletionReference = {
  prefix: '$' | '/';
  text: string;
  query: string;
  range: vscode.Range;
};

export class AgentCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly getCompletions: () => AgentCompletionConfig) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const reference = getAgentCompletionReference(document, position);
    if (!reference) {
      return [];
    }

    return dedupeAgentCompletions(normalizeAgentCompletions(this.getCompletions(), reference.prefix))
      .map((completion, index) => {
        return {
          completion,
          index,
          score: getAgentCompletionMatchScore(reference.query, completion)
        };
      })
      .filter((match): match is { completion: AgentCompletion; index: number; score: number } => {
        return match.score !== undefined;
      })
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map(({ completion }) => {
        const item = new vscode.CompletionItem(completion.alias, vscode.CompletionItemKind.Keyword);
        item.insertText = completion.insertText;
        item.range = reference.range;
        if (completion.alias !== completion.insertText) {
          item.detail = completion.insertText;
        }
        return item;
      });
  }
}

function getAgentCompletionReference(
  document: vscode.TextDocument,
  position: vscode.Position
): AgentCompletionReference | undefined {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const match = /(?:^|\s)([$/][\w:.-]*)$/.exec(linePrefix);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const text = match[1];
  const prefix = text[0];
  if (prefix !== '$' && prefix !== '/') {
    return undefined;
  }

  const startCharacter = linePrefix.length - text.length;
  return {
    prefix,
    text,
    query: text.slice(1),
    range: new vscode.Range(position.line, startCharacter, position.line, position.character)
  };
}
