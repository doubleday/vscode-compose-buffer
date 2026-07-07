import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  CommitBehavior,
  ImageReferenceStyle,
  createImageFileName,
  formatImageReference,
  normalizeImageDirectory,
  normalizeWorkspacePath,
  shouldSendToTerminal
} from './helpers';
import {
  PathCompletionQuery,
  PathIndex,
  createPathIndex,
  getShortestUniquePathSuffix,
  parsePathCompletionQuery,
  searchPathIndex
} from './pathIndex';

const languageId = 'compose-buffer';
const contextKey = 'composeBuffer.active';
const fileCompletionLimit = 200;
const fileIndexLimit = 50000;
const fileSearchExclude = '**/{.git,node_modules,dist,out,build,coverage}/**';
const pathCompletionTriggerCharacters = [
  '@',
  ':',
  '?',
  '/',
  '.',
  '-',
  '_',
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
];

type AgentCompletionValue = string | string[];
type AgentCompletionConfig = string[] | Record<string, AgentCompletionValue>;
type AgentCompletion = {
  alias: string;
  insertText: string;
};
type AgentCompletionReference = {
  prefix: '$' | '/';
  text: string;
  query: string;
  range: vscode.Range;
};

let activeBufferUri: vscode.Uri | undefined;
let capturedTerminal: vscode.Terminal | undefined;
let lastTerminal: vscode.Terminal | undefined;
let workspacePathIndex: PathIndex | undefined;
let workspacePathIndexPromise: Promise<PathIndex> | undefined;
let workspacePathIndexTruncated = false;

export function activate(context: vscode.ExtensionContext) {
  lastTerminal = vscode.window.activeTerminal;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (terminal) {
        lastTerminal = terminal;
      }
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === capturedTerminal) {
        capturedTerminal = undefined;
      }
      if (terminal === lastTerminal) {
        lastTerminal = undefined;
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateActiveContext()),
    vscode.commands.registerCommand('composeBuffer.open', openComposeBuffer),
    vscode.commands.registerCommand('composeBuffer.commit', () => commitComposeBuffer(false)),
    vscode.commands.registerCommand('composeBuffer.copyOnly', () => commitComposeBuffer(true)),
    vscode.commands.registerCommand('composeBuffer.cancel', cancelComposeBuffer),
    vscode.commands.registerCommand('composeBuffer.rebuildFileIndex', rebuildWorkspacePathIndex),
    vscode.languages.registerCompletionItemProvider(
      { language: languageId },
      new WorkspaceFileCompletionProvider(),
      ...pathCompletionTriggerCharacters
    ),
    vscode.languages.registerCompletionItemProvider(
      { language: languageId },
      new AgentCompletionProvider(),
      '$',
      '/'
    ),
    vscode.languages.registerDocumentPasteEditProvider(
      { language: languageId },
      new ImagePasteProvider(),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text],
        pasteMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
      }
    )
  );

  updateActiveContext();
}

export function deactivate() {
  return undefined;
}

async function openComposeBuffer() {
  capturedTerminal = vscode.window.activeTerminal ?? lastTerminal;

  if (activeBufferUri) {
    const existing = vscode.workspace.textDocuments.find((document) => document.uri.toString() === activeBufferUri?.toString());
    if (existing) {
      await vscode.window.showTextDocument(existing, { preview: false });
      await enterVimInsertMode();
      await updateActiveContext();
      return;
    }
  }

  const fileName = `compose-buffer-${Date.now()}.compose.md`;
  const filePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(filePath, '', 'utf8');

  activeBufferUri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(activeBufferUri);
  await vscode.languages.setTextDocumentLanguage(document, languageId);
  await vscode.window.showTextDocument(document, { preview: false });
  await enterVimInsertMode();
  await updateActiveContext();
}

async function commitComposeBuffer(copyOnly: boolean) {
  const document = await getActiveBufferDocument();
  if (!document) {
    return;
  }

  const text = document.getText();
  await vscode.env.clipboard.writeText(text);

  const behavior = getCommitBehavior();
  const terminal = capturedTerminal ?? lastTerminal;
  const shouldSend = !copyOnly && shouldSendToTerminal(behavior, Boolean(terminal)) && terminal;

  await closeAndDeleteBuffer(document);

  if (shouldSend) {
    terminal.show(false);
    terminal.sendText(text, false);
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
  }
}

async function cancelComposeBuffer() {
  const document = await getActiveBufferDocument();
  if (!document) {
    return;
  }

  const terminal = capturedTerminal ?? lastTerminal;
  await closeAndDeleteBuffer(document);

  if (terminal) {
    terminal.show(false);
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
  }
}

async function getActiveBufferDocument(): Promise<vscode.TextDocument | undefined> {
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (isComposeBuffer(activeDocument)) {
    return activeDocument;
  }

  if (!activeBufferUri) {
    return undefined;
  }

  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === activeBufferUri?.toString());
}

async function closeAndDeleteBuffer(document: vscode.TextDocument) {
  await vscode.window.showTextDocument(document, { preview: false });
  await document.save();
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

  const uri = document.uri;
  activeBufferUri = undefined;
  capturedTerminal = undefined;
  await updateActiveContext();

  try {
    await fs.unlink(uri.fsPath);
  } catch {
    // Temp-file cleanup is best effort.
  }
}

function isComposeBuffer(document: vscode.TextDocument | undefined): boolean {
  return Boolean(document && activeBufferUri && document.uri.toString() === activeBufferUri.toString());
}

async function updateActiveContext() {
  await vscode.commands.executeCommand('setContext', contextKey, isComposeBuffer(vscode.window.activeTextEditor?.document));
}

async function enterVimInsertMode() {
  const commands = await vscode.commands.getCommands(true);
  if (commands.includes('extension.vim_insert')) {
    await vscode.commands.executeCommand('extension.vim_insert');
  }
}

function getCommitBehavior(): CommitBehavior {
  return vscode.workspace
    .getConfiguration('composeBuffer')
    .get<CommitBehavior>('commitBehavior', 'copyAndPaste');
}

function getImageReferenceStyle(): ImageReferenceStyle {
  return vscode.workspace
    .getConfiguration('composeBuffer')
    .get<ImageReferenceStyle>('imageReferenceStyle', 'atPath');
}

function getImageDirectory(): string {
  return normalizeImageDirectory(
    vscode.workspace.getConfiguration('composeBuffer').get<string>('imageDirectory', '.images')
  );
}

function getAgentCompletions(): AgentCompletionConfig {
  return vscode.workspace
    .getConfiguration('composeBuffer')
    .get<AgentCompletionConfig>('agentCompletions', []);
}

class WorkspaceFileCompletionProvider implements vscode.CompletionItemProvider {
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
      index = await getWorkspacePathIndex(token);
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
    const paths = searchPathIndex(index, query, fileCompletionLimit);
    const items = paths.map((relativePath, index) => {
      const displayPath = getShortestUniquePathSuffix(relativePath, paths);
      return createPathCompletionItem(relativePath, displayPath, query, range, referenceText, index);
    });

    return new vscode.CompletionList(items, true);
  }
}

async function rebuildWorkspacePathIndex() {
  workspacePathIndex = undefined;
  workspacePathIndexPromise = undefined;
  workspacePathIndexTruncated = false;

  if (!vscode.workspace.workspaceFolders?.length) {
    await vscode.window.showInformationMessage('Compose Buffer file index skipped because no workspace is open.');
    return;
  }

  await getWorkspacePathIndex();
  const suffix = workspacePathIndexTruncated ? ` The first ${fileIndexLimit} files were indexed.` : '';
  await vscode.window.showInformationMessage(`Compose Buffer file index rebuilt.${suffix}`);
}

async function getWorkspacePathIndex(token?: vscode.CancellationToken): Promise<PathIndex> {
  if (workspacePathIndex) {
    return workspacePathIndex;
  }

  if (!workspacePathIndexPromise) {
    workspacePathIndexPromise = buildWorkspacePathIndex(token);
  }

  try {
    workspacePathIndex = await workspacePathIndexPromise;
    return workspacePathIndex;
  } catch (error) {
    workspacePathIndexPromise = undefined;
    throw error;
  }
}

async function buildWorkspacePathIndex(token?: vscode.CancellationToken): Promise<PathIndex> {
  const files = await vscode.workspace.findFiles('**/*', fileSearchExclude, fileIndexLimit, token);
  workspacePathIndexTruncated = files.length >= fileIndexLimit;
  const paths = files.map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false)));
  return createPathIndex(paths);
}

function createPathCompletionItem(
  relativePath: string,
  displayPath: string,
  query: PathCompletionQuery,
  range: vscode.Range,
  referenceText: string,
  index: number
): vscode.CompletionItem {
  const isDirectory = query.mode === 'directory';
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
    detail: detail ? ` ${detail}` : undefined,
    description: relativePath
  };
}

function getAtReferenceRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const match = /(?:^|\s)(@[\w./:?-]*)$/.exec(linePrefix);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const startCharacter = linePrefix.length - match[1].length;
  return new vscode.Range(position.line, startCharacter, position.line, position.character);
}

class AgentCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const reference = getAgentCompletionReference(document, position);
    if (!reference) {
      return [];
    }

    return dedupeAgentCompletions(normalizeAgentCompletions(getAgentCompletions(), reference.prefix))
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

function dedupeAgentCompletions(completions: AgentCompletion[]): AgentCompletion[] {
  return completions.filter((completion, index) => {
    return completions.findIndex((candidate) => {
      return candidate.alias === completion.alias && candidate.insertText === completion.insertText;
    }) === index;
  });
}

function getAgentCompletionMatchScore(query: string, completion: AgentCompletion): number | undefined {
  if (!query) {
    return 0;
  }

  const aliasScore = getFuzzyMatchScore(query, completion.alias.slice(1));
  const insertTextScore = getFuzzyMatchScore(query, completion.insertText.slice(1));
  const scores = [aliasScore, insertTextScore].filter((score): score is number => score !== undefined);
  return scores.length ? Math.min(...scores) : undefined;
}

function getFuzzyMatchScore(query: string, target: string): number | undefined {
  const normalizedQuery = normalizeFuzzyText(query);
  const normalizedTarget = normalizeFuzzyText(target);

  if (!normalizedQuery) {
    return 0;
  }

  if (!normalizedTarget) {
    return undefined;
  }

  if (normalizedTarget.startsWith(normalizedQuery)) {
    return normalizedTarget.length - normalizedQuery.length;
  }

  const index = normalizedTarget.indexOf(normalizedQuery);
  if (index >= 0) {
    return 50 + index;
  }

  let targetIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let gapScore = 0;

  for (const char of normalizedQuery) {
    const matchIndex = normalizedTarget.indexOf(char, targetIndex);
    if (matchIndex < 0) {
      return undefined;
    }

    if (firstMatchIndex < 0) {
      firstMatchIndex = matchIndex;
    }
    if (lastMatchIndex >= 0) {
      gapScore += matchIndex - lastMatchIndex - 1;
    }

    lastMatchIndex = matchIndex;
    targetIndex = matchIndex + 1;
  }

  return 100 + firstMatchIndex + gapScore;
}

function normalizeFuzzyText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
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

function normalizeAgentCompletions(config: AgentCompletionConfig, activePrefix: '$' | '/'): AgentCompletion[] {
  if (Array.isArray(config)) {
    return config
      .map((completion) => normalizeAgentCompletion(completion, completion, activePrefix))
      .filter((completion): completion is AgentCompletion => Boolean(completion));
  }

  if (typeof config === 'object' && config) {
    return Object.entries(config)
      .flatMap(([alias, insertText]) => {
        const insertTexts = Array.isArray(insertText) ? insertText : [insertText];
        return insertTexts.map((value) => normalizeAgentCompletion(alias, value, activePrefix));
      })
      .filter((completion): completion is AgentCompletion => Boolean(completion));
  }

  return [];
}

function normalizeAgentCompletion(
  alias: string,
  insertText: string,
  activePrefix: '$' | '/'
): AgentCompletion | undefined {
  const normalizedAlias = normalizeAgentCompletionText(alias, activePrefix);
  const normalizedInsertText = normalizeAgentCompletionText(insertText, activePrefix);
  if (!normalizedAlias || !normalizedInsertText) {
    return undefined;
  }

  return {
    alias: normalizedAlias,
    insertText: normalizedInsertText
  };
}

function normalizeAgentCompletionText(text: string, activePrefix: '$' | '/'): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('$') || trimmed.startsWith('/')) {
    return trimmed.startsWith(activePrefix) ? trimmed : undefined;
  }

  return `${activePrefix}${trimmed}`;
}

class ImagePasteProvider implements vscode.DocumentPasteEditProvider {
  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (!isComposeBuffer(document)) {
      return undefined;
    }

    const image = getFirstImage(dataTransfer);
    if (!image) {
      return undefined;
    }

    const file = image.asFile();
    if (!file) {
      return undefined;
    }

    const bytes = await file.data();
    if (token.isCancellationRequested) {
      return undefined;
    }

    const target = getImageTarget();
    if (!target) {
      return undefined;
    }

    await vscode.workspace.fs.createDirectory(target.directory);
    await vscode.workspace.fs.writeFile(target.file, bytes);

    const edit = new vscode.DocumentPasteEdit(
      formatImageReference(target.referencePath, getImageReferenceStyle()),
      'Insert pasted image reference',
      vscode.DocumentDropOrPasteEditKind.Text
    );

    return ranges.length ? [edit] : undefined;
  }
}

function getFirstImage(dataTransfer: vscode.DataTransfer): vscode.DataTransferItem | undefined {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    const item = dataTransfer.get(mime);
    if (item) {
      return item;
    }
  }

  return undefined;
}

function getImageTarget(): { directory: vscode.Uri; file: vscode.Uri; referencePath: string } | undefined {
  const root = getPreferredImageRoot();
  if (!root) {
    return undefined;
  }

  const imageDirectory = getImageDirectory();
  const directory = vscode.Uri.joinPath(root, ...imageDirectory.split('/'));
  const fileName = createImageFileName();
  return {
    directory,
    file: vscode.Uri.joinPath(directory, fileName),
    referencePath: `${imageDirectory}/${fileName}`
  };
}

function getPreferredImageRoot(): vscode.Uri | undefined {
  const cwd = capturedTerminal?.shellIntegration?.cwd ?? lastTerminal?.shellIntegration?.cwd;
  if (cwd && vscode.workspace.getWorkspaceFolder(cwd)) {
    return cwd;
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri;
}
