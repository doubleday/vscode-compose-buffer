import * as vscode from 'vscode';
import { AgentCompletionConfig } from './agentCompletions';
import { AgentCompletionProvider } from './agentCompletionProvider';
import { ComposeBufferSession } from './composeBufferSession';
import {
  ImageReferenceStyle,
  normalizeImageDirectory
} from './helpers';
import { ImagePasteProvider, imagePasteMimeTypes } from './imagePasteProvider';
import { WorkspaceFileCompletionProvider, pathCompletionTriggerCharacters } from './pathCompletionProvider';
import { WorkspacePathIndex } from './workspacePathIndex';

const languageId = 'compose-buffer';
const fileCompletionLimit = 200;

const workspacePathIndex = new WorkspacePathIndex();

export function activate(context: vscode.ExtensionContext) {
  const session = new ComposeBufferSession(context, languageId);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(session.handleActiveTerminalChanged),
    vscode.window.onDidCloseTerminal(session.handleTerminalClosed),
    vscode.window.onDidChangeActiveTextEditor(session.updateActiveContext),
    vscode.commands.registerCommand('composeBuffer.open', session.open),
    vscode.commands.registerCommand('composeBuffer.restoreLastPrompt', session.restoreLastPrompt),
    vscode.commands.registerCommand('composeBuffer.restoreLastPromptFromTerminal', session.restoreLastPromptFromTerminal),
    vscode.commands.registerCommand('composeBuffer.commit', session.commit),
    vscode.commands.registerCommand('composeBuffer.copyOnly', session.copyOnly),
    vscode.commands.registerCommand('composeBuffer.cancel', session.cancel),
    vscode.commands.registerCommand('composeBuffer.rebuildFileIndex', workspacePathIndex.rebuild),
    vscode.languages.registerCompletionItemProvider(
      { language: languageId },
      new WorkspaceFileCompletionProvider(workspacePathIndex.getIndex, fileCompletionLimit),
      ...pathCompletionTriggerCharacters
    ),
    vscode.languages.registerCompletionItemProvider(
      { language: languageId },
      new AgentCompletionProvider(getAgentCompletions),
      '$',
      '/'
    ),
    vscode.languages.registerDocumentPasteEditProvider(
      { language: languageId },
      new ImagePasteProvider({
        isComposeBuffer: session.isComposeBuffer,
        getPreferredImageRoot: session.getPreferredImageRoot,
        getImageDirectory,
        getImageReferenceStyle
      }),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text],
        pasteMimeTypes: imagePasteMimeTypes
      }
    )
  );

  session.updateActiveContext();
}

export function deactivate() {
  return undefined;
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
