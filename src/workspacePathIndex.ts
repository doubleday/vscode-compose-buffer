import * as vscode from 'vscode';
import { normalizeWorkspacePath } from './helpers';
import { PathIndex, createPathIndex } from './pathIndex';

const fileIndexLimit = 50000;
const fileSearchExclude = '**/{.git,node_modules,dist,out,build,coverage}/**';

export class WorkspacePathIndex {
  private index: PathIndex | undefined;
  private indexPromise: Promise<PathIndex> | undefined;
  private truncated = false;

  readonly getIndex = async (token?: vscode.CancellationToken): Promise<PathIndex> => {
    if (this.index) {
      return this.index;
    }

    if (!this.indexPromise) {
      this.indexPromise = this.build(token);
    }

    try {
      this.index = await this.indexPromise;
      return this.index;
    } catch (error) {
      this.indexPromise = undefined;
      throw error;
    }
  };

  readonly rebuild = async (): Promise<void> => {
    this.index = undefined;
    this.indexPromise = undefined;
    this.truncated = false;

    if (!vscode.workspace.workspaceFolders?.length) {
      await vscode.window.showInformationMessage('Compose Buffer file index skipped because no workspace is open.');
      return;
    }

    await this.getIndex();
    const suffix = this.truncated ? ` The first ${fileIndexLimit} files were indexed.` : '';
    await vscode.window.showInformationMessage(`Compose Buffer file index rebuilt.${suffix}`);
  };

  private async build(token?: vscode.CancellationToken): Promise<PathIndex> {
    const files = await vscode.workspace.findFiles('**/*', fileSearchExclude, fileIndexLimit, token);
    this.truncated = files.length >= fileIndexLimit;
    const paths = files.map((uri) => normalizeWorkspacePath(vscode.workspace.asRelativePath(uri, false)));
    return createPathIndex(paths);
  }
}
