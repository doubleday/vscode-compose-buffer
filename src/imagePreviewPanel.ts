import * as vscode from 'vscode';
import { ImagePreviewCollection } from './imagePreviewCollection';

export class ImagePreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private createdGroup: vscode.ViewColumn | undefined;
  private readonly images = new ImagePreviewCollection<vscode.Uri>();

  get hasImages(): boolean {
    return this.images.hasEntries;
  }

  addImage(image: vscode.Uri): void {
    this.images.add(image);
    this.show();
  }

  toggle(): void {
    if (this.panel) {
      this.hide();
      return;
    }

    this.show();
  }

  dispose(): void {
    this.hide();
    this.images.clear();
  }

  private show(): void {
    if (!this.hasImages) {
      return;
    }

    if (!this.panel) {
      const existingGroups = new Set(vscode.window.tabGroups.all.map((group) => group.viewColumn));
      this.panel = vscode.window.createWebviewPanel(
        'composeBuffer.imagePreview',
        'Pasted Images',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: false,
          localResourceRoots: vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
        }
      );
      const viewColumn = this.panel.viewColumn;
      this.createdGroup = viewColumn !== undefined && !existingGroups.has(viewColumn)
        ? viewColumn
        : undefined;
      this.panel.onDidDispose(() => {
        const createdGroup = this.createdGroup;
        this.panel = undefined;
        this.createdGroup = undefined;
        this.closeOwnedEmptyGroup(createdGroup);
      });
    }

    this.panel.title = `Pasted Images (${this.images.values.length})`;
    this.panel.webview.html = this.getHtml(this.panel.webview);
  }

  private hide(): void {
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
  }

  private closeOwnedEmptyGroup(createdGroup: vscode.ViewColumn | undefined): void {
    if (!createdGroup) {
      return;
    }

    const group = vscode.window.tabGroups.all.find(
      (candidate) => candidate.viewColumn === createdGroup
    );
    if (group?.tabs.length === 0) {
      void vscode.window.tabGroups.close(group, true).then(undefined, () => undefined);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const images = this.images.values.map((image) => {
      const source = webview.asWebviewUri(image).toString();
      const fileName = image.path.split('/').pop() ?? 'Pasted image';
      return `<figure><img src="${source}" alt="${escapeHtml(fileName)}" loading="lazy"><figcaption>${escapeHtml(fileName)}</figcaption></figure>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); margin: 0; padding: 12px; }
    figure { margin: 0 0 16px; }
    img { background: var(--vscode-editor-background); display: block; height: auto; max-width: 100%; }
    figcaption { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
  </style>
</head>
<body>${images}</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] ?? character);
}
