import * as vscode from 'vscode';
import { formatPathTail } from './helpers';
import {
  PathIndex,
  getShortestUniquePathSuffix,
  parsePathCompletionQuery,
  searchPathIndexWithTypes
} from './pathIndex';

const pathCompletionDetailLimit = 28;

export const pathCompletionTriggerCharacters = [
  '@',
  ':',
  '/',
  '.',
  '-',
  '_',
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
];

export class WorkspaceFileCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly getPathIndex: (token: vscode.CancellationToken) => Promise<PathIndex>,
    private readonly resultLimit: number
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionList> {
    const range = getAtReferenceRange(document, position);
    if (!range || !vscode.workspace.workspaceFolders?.length) {
      return new vscode.CompletionList();
    }

    let index: PathIndex;
    try {
      index = await this.getPathIndex(token);
    } catch (error) {
      if (token.isCancellationRequested) {
        return new vscode.CompletionList();
      }
      throw error;
    }

    if (token.isCancellationRequested) {
      return new vscode.CompletionList();
    }

    const referenceText = document.getText(range);
    const query = parsePathCompletionQuery(referenceText.slice(1));
    const results = searchPathIndexWithTypes(index, query, this.resultLimit);
    const paths = results.map((result) => result.path);
    const items = results.map((result, resultIndex) => {
      const displayPath = getShortestUniquePathSuffix(result.path, paths);
      return createPathCompletionItem(
        result.path,
        displayPath,
        result.isDirectory,
        range,
        referenceText,
        resultIndex
      );
    });

    return new vscode.CompletionList(items, true);
  }
}

function createPathCompletionItem(
  relativePath: string,
  displayPath: string,
  isDirectory: boolean,
  range: vscode.Range,
  referenceText: string,
  index: number
): vscode.CompletionItem {
  const insertedPath = isDirectory ? `${relativePath}/` : relativePath;
  const labelPath = isDirectory ? `${displayPath}/` : displayPath;
  const item = new vscode.CompletionItem(
    createPathCompletionLabel(insertedPath, labelPath),
    isDirectory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
  );
  item.insertText = `@${insertedPath}`;
  item.range = range;
  item.filterText = referenceText;
  item.sortText = index.toString().padStart(4, '0');
  return item;
}

function createPathCompletionLabel(relativePath: string, displayPath: string): vscode.CompletionItemLabel {
  const detail = relativePath.endsWith(displayPath)
    ? relativePath.slice(0, relativePath.length - displayPath.length)
    : undefined;

  return {
    label: `@${displayPath}`,
    detail: detail ? ` ${formatPathTail(detail, pathCompletionDetailLimit)}` : undefined
  };
}

function getAtReferenceRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const match = /(?:^|\s)(@[\w./:-]*)$/.exec(linePrefix);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const startCharacter = linePrefix.length - match[1].length;
  return new vscode.Range(position.line, startCharacter, position.line, position.character);
}
