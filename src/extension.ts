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

const languageId = 'compose-buffer';
const contextKey = 'composeBuffer.active';

let activeBufferUri: vscode.Uri | undefined;
let capturedTerminal: vscode.Terminal | undefined;
let lastTerminal: vscode.Terminal | undefined;

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
    vscode.languages.registerCompletionItemProvider(
      { language: languageId },
      new WorkspaceFileCompletionProvider(),
      '@'
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

class WorkspaceFileCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[]> {
    const range = getAtReferenceRange(document, position);
    if (!range || !vscode.workspace.workspaceFolders?.length) {
      return [];
    }

    const files = await vscode.workspace.findFiles('**/*', '**/{.git,node_modules}/**', 200);
    return files.map((uri) => {
      const relativePath = normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false));
      const item = new vscode.CompletionItem(`@${relativePath}`, vscode.CompletionItemKind.File);
      item.insertText = `@${relativePath}`;
      item.range = range;
      return item;
    });
  }
}

function getAtReferenceRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | undefined {
  const linePrefix = document.lineAt(position).text.slice(0, position.character);
  const match = /(?:^|\s)(@[\w./-]*)$/.exec(linePrefix);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const startCharacter = linePrefix.length - match[1].length;
  return new vscode.Range(position.line, startCharacter, position.line, position.character);
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
