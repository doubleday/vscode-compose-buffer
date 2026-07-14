import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentCompletion,
  AgentCompletionConfig,
  dedupeAgentCompletions,
  getAgentCompletionMatchScore,
  normalizeAgentCompletions
} from './agentCompletions';
import {
  CommitBehavior,
  ImageReferenceStyle,
  createImageFileName,
  formatPathTail,
  formatImageReference,
  normalizeImageDirectory,
  normalizeWorkspacePath,
  shouldSendToTerminal
} from './helpers';
import {
  PathIndex,
  createPathIndex,
  getShortestUniquePathSuffix,
  parsePathCompletionQuery,
  searchPathIndexWithTypes
} from './pathIndex';

const languageId = 'compose-buffer';
const contextKey = 'composeBuffer.active';
const lastPromptKey = 'composeBuffer.lastPrompt';
const fileCompletionLimit = 200;
const fileIndexLimit = 50000;
const fileSearchExclude = '**/{.git,node_modules,dist,out,build,coverage}/**';
const pathCompletionDetailLimit = 28;
const pathCompletionTriggerCharacters = [
  '@',
  ':',
  '/',
  '.',
  '-',
  '_',
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
];

type AgentCompletionReference = {
  prefix: '$' | '/';
  text: string;
  query: string;
  range: vscode.Range;
};

let activeBufferUri: vscode.Uri | undefined;
let capturedTerminal: vscode.Terminal | undefined;
let lastTerminal: vscode.Terminal | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let workspacePathIndex: PathIndex | undefined;
let workspacePathIndexPromise: Promise<PathIndex> | undefined;
let workspacePathIndexTruncated = false;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
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
    vscode.commands.registerCommand('composeBuffer.restoreLastPrompt', restoreLastPrompt),
    vscode.commands.registerCommand('composeBuffer.restoreLastPromptFromTerminal', restoreLastPromptFromTerminal),
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
  return openComposeBufferWithText();
}

async function openComposeBufferWithText(text?: string) {
  capturedTerminal = vscode.window.activeTerminal ?? lastTerminal;

  if (activeBufferUri) {
    const existing = vscode.workspace.textDocuments.find((document) => document.uri.toString() === activeBufferUri?.toString());
    if (existing) {
      await vscode.window.showTextDocument(existing, { preview: false });
      if (text !== undefined) {
        await replaceDocumentText(existing, text);
      }
      await enterVimInsertMode();
      await updateActiveContext();
      return;
    }
  }

  const fileName = `compose-buffer-${Date.now()}.compose.md`;
  const filePath = path.join(os.tmpdir(), fileName);
  await fs.writeFile(filePath, text ?? '', 'utf8');

  activeBufferUri = vscode.Uri.file(filePath);
  const document = await vscode.workspace.openTextDocument(activeBufferUri);
  await vscode.languages.setTextDocumentLanguage(document, languageId);
  await vscode.window.showTextDocument(document, { preview: false });
  await enterVimInsertMode();
  await updateActiveContext();
}

async function restoreLastPrompt() {
  const lastPrompt = getLastPrompt();
  if (lastPrompt === undefined) {
    await vscode.window.showInformationMessage('Compose Buffer has no saved prompt yet.');
    return;
  }

  await openComposeBufferWithText(lastPrompt);
}

async function restoreLastPromptFromTerminal() {
  const terminal = vscode.window.activeTerminal ?? lastTerminal;
  if (terminal) {
    terminal.sendText('\u0003', false);
  }

  await restoreLastPrompt();
}

async function commitComposeBuffer(copyOnly: boolean) {
  const document = await getActiveBufferDocument();
  if (!document) {
    return;
  }

  const text = document.getText();
  await saveLastPrompt(text);
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

  await saveLastPrompt(document.getText());

  const terminal = capturedTerminal ?? lastTerminal;
  await closeAndDeleteBuffer(document);

  if (terminal) {
    terminal.show(false);
    await vscode.commands.executeCommand('workbench.action.terminal.focus');
  }
}

async function replaceDocumentText(document: vscode.TextDocument, text: string) {
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, text);
  });
}

function getLastPrompt(): string | undefined {
  return extensionContext?.globalState.get<string>(lastPromptKey);
}

async function saveLastPrompt(text: string) {
  if (extensionContext && text.length > 0) {
    await extensionContext.globalState.update(lastPromptKey, text);
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
    const results = searchPathIndexWithTypes(index, query, fileCompletionLimit);
    const paths = results.map((result) => result.path);
    const items = results.map((result, index) => {
      const displayPath = getShortestUniquePathSuffix(result.path, paths);
      return createPathCompletionItem(
        result.path,
        displayPath,
        result.isDirectory,
        range,
        referenceText,
        index
      );
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
