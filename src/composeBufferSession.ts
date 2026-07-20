import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CommitBehavior, shouldSendToTerminal } from './helpers';
import { ImagePreviewPanel } from './imagePreviewPanel';

const contextKey = 'composeBuffer.active';
const lastPromptKey = 'composeBuffer.lastPrompt';

export class ComposeBufferSession implements vscode.Disposable {
  private activeBufferUri: vscode.Uri | undefined;
  private capturedTerminal: vscode.Terminal | undefined;
  private lastTerminal: vscode.Terminal | undefined;
  private readonly imagePreview: ImagePreviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly languageId: string
  ) {
    this.lastTerminal = vscode.window.activeTerminal;
    this.imagePreview = new ImagePreviewPanel();
  }

  readonly handleActiveTerminalChanged = (terminal: vscode.Terminal | undefined): void => {
    if (terminal) {
      this.lastTerminal = terminal;
    }
  };

  readonly handleTerminalClosed = (terminal: vscode.Terminal): void => {
    if (terminal === this.capturedTerminal) {
      this.capturedTerminal = undefined;
    }
    if (terminal === this.lastTerminal) {
      this.lastTerminal = undefined;
    }
  };

  readonly updateActiveContext = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      'setContext',
      contextKey,
      this.isComposeBuffer(vscode.window.activeTextEditor?.document)
    );
  };

  readonly open = async (): Promise<void> => {
    await this.discardActiveBuffer();
    await this.openWithText();
  };

  readonly restoreLastPrompt = async (): Promise<void> => {
    const lastPrompt = this.getLastPrompt();
    if (lastPrompt === undefined) {
      await vscode.window.showInformationMessage('Compose Buffer has no saved prompt yet.');
      return;
    }

    await this.openWithText(lastPrompt);
  };

  readonly restoreLastPromptFromTerminal = async (): Promise<void> => {
    const terminal = vscode.window.activeTerminal ?? this.lastTerminal;
    if (terminal) {
      terminal.sendText('\u0003', false);
    }

    await this.restoreLastPrompt();
  };

  readonly commit = async (): Promise<void> => {
    await this.commitBuffer(false);
  };

  readonly copyOnly = async (): Promise<void> => {
    await this.commitBuffer(true);
  };

  readonly toggleImagePreview = (): void => {
    if (!this.isComposeBuffer(vscode.window.activeTextEditor?.document)) {
      return;
    }
    if (!this.imagePreview.hasImages) {
      void vscode.window.showInformationMessage('Compose Buffer has no pasted images yet.');
      return;
    }

    this.imagePreview.toggle();
  };

  dispose(): void {
    this.imagePreview.dispose();
  }

  readonly cancel = async (): Promise<void> => {
    const document = await this.getActiveBufferDocument();
    if (!document) {
      return;
    }

    await this.saveLastPrompt(document.getText());

    const terminal = this.capturedTerminal ?? this.lastTerminal;
    await this.closeAndDeleteBuffer(document);

    if (terminal) {
      terminal.show(false);
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
    }
  };

  readonly isComposeBuffer = (document: vscode.TextDocument | undefined): boolean => {
    return Boolean(
      document
      && this.activeBufferUri
      && document.uri.toString() === this.activeBufferUri.toString()
    );
  };

  readonly getPreferredImageRoot = (): vscode.Uri | undefined => {
    const cwd = this.capturedTerminal?.shellIntegration?.cwd ?? this.lastTerminal?.shellIntegration?.cwd;
    if (cwd && vscode.workspace.getWorkspaceFolder(cwd)) {
      return cwd;
    }

    return vscode.workspace.workspaceFolders?.[0]?.uri;
  };

  readonly showImagePreview = async (
    image: vscode.Uri,
    document: vscode.TextDocument
  ): Promise<void> => {
    if (!this.shouldOpenImagePreview() || !this.isComposeBuffer(document)) {
      return;
    }

    const composeEditor = vscode.window.visibleTextEditors.find(
      (editor) => editor.document.uri.toString() === document.uri.toString()
    );
    if (!composeEditor) {
      return;
    }

    try {
      this.imagePreview.addImage(image);
      await vscode.window.showTextDocument(document, {
        viewColumn: composeEditor.viewColumn,
        preview: false,
        preserveFocus: false
      });
    } catch {
      // A preview is optional and must never prevent the paste itself.
    }
  };

  private async openWithText(text?: string): Promise<void> {
    this.capturedTerminal = vscode.window.activeTerminal ?? this.lastTerminal;

    if (this.activeBufferUri) {
      const existing = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === this.activeBufferUri?.toString()
      );
      if (existing) {
        await vscode.window.showTextDocument(existing, { preview: false });
        if (text !== undefined) {
          await this.replaceDocumentText(existing, text);
        }
        await this.enterVimInsertMode();
        await this.updateActiveContext();
        return;
      }
    }

    const fileName = `compose-buffer-${Date.now()}.compose.md`;
    const filePath = path.join(os.tmpdir(), fileName);
    await fs.writeFile(filePath, text ?? '', 'utf8');

    this.activeBufferUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(this.activeBufferUri);
    await vscode.languages.setTextDocumentLanguage(document, this.languageId);
    await vscode.window.showTextDocument(document, { preview: false });
    await this.enterVimInsertMode();
    await this.updateActiveContext();
  }

  private async discardActiveBuffer(): Promise<void> {
    if (!this.activeBufferUri) {
      return;
    }

    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === this.activeBufferUri?.toString()
    );
    if (document) {
      await this.closeAndDeleteBuffer(document);
      return;
    }

    this.activeBufferUri = undefined;
    this.capturedTerminal = undefined;
    this.imagePreview.dispose();
    await this.updateActiveContext();
  }

  private async commitBuffer(copyOnly: boolean): Promise<void> {
    const document = await this.getActiveBufferDocument();
    if (!document) {
      return;
    }

    const text = document.getText();
    await this.saveLastPrompt(text);
    await vscode.env.clipboard.writeText(text);

    const behavior = this.getCommitBehavior();
    const terminal = this.capturedTerminal ?? this.lastTerminal;
    const shouldSend = !copyOnly && shouldSendToTerminal(behavior, Boolean(terminal)) && terminal;

    await this.closeAndDeleteBuffer(document);

    if (shouldSend) {
      terminal.show(false);
      terminal.sendText(text, false);
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
    }
  }

  private async replaceDocumentText(document: vscode.TextDocument, text: string): Promise<void> {
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );
    await editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, text);
    });
  }

  private getLastPrompt(): string | undefined {
    return this.context.globalState.get<string>(lastPromptKey);
  }

  private async saveLastPrompt(text: string): Promise<void> {
    if (text.length > 0) {
      await this.context.globalState.update(lastPromptKey, text);
    }
  }

  private async getActiveBufferDocument(): Promise<vscode.TextDocument | undefined> {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (this.isComposeBuffer(activeDocument)) {
      return activeDocument;
    }

    if (!this.activeBufferUri) {
      return undefined;
    }

    return vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === this.activeBufferUri?.toString()
    );
  }

  private async closeAndDeleteBuffer(document: vscode.TextDocument): Promise<void> {
    this.imagePreview.dispose();
    await vscode.window.showTextDocument(document, { preview: false });
    await document.save();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

    const uri = document.uri;
    this.activeBufferUri = undefined;
    this.capturedTerminal = undefined;
    await this.updateActiveContext();

    try {
      await fs.unlink(uri.fsPath);
    } catch {
      // Temp-file cleanup is best effort.
    }
  }

  private async enterVimInsertMode(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('extension.vim_insert')) {
      await vscode.commands.executeCommand('extension.vim_insert');
    }
  }

  private getCommitBehavior(): CommitBehavior {
    return vscode.workspace
      .getConfiguration('composeBuffer')
      .get<CommitBehavior>('commitBehavior', 'copyAndPaste');
  }

  private shouldOpenImagePreview(): boolean {
    return vscode.workspace
      .getConfiguration('composeBuffer')
      .get<boolean>('openImagePreviewOnPaste', true);
  }
}
