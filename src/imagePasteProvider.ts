import * as vscode from 'vscode';
import {
  ImageReferenceStyle,
  createImageFileName,
  formatImageReference
} from './helpers';

export const imagePasteMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

interface ImagePasteProviderOptions {
  isComposeBuffer(document: vscode.TextDocument): boolean;
  getPreferredImageRoot(): vscode.Uri | undefined;
  getImageDirectory(): string;
  getImageReferenceStyle(): ImageReferenceStyle;
  showImagePreview(file: vscode.Uri, document: vscode.TextDocument): Thenable<unknown>;
}

interface ImageTarget {
  directory: vscode.Uri;
  file: vscode.Uri;
  referencePath: string;
}

export class ImagePasteProvider implements vscode.DocumentPasteEditProvider {
  constructor(private readonly options: ImagePasteProviderOptions) {}

  async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    _context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (!this.options.isComposeBuffer(document)) {
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

    const target = getImageTarget(
      this.options.getPreferredImageRoot(),
      this.options.getImageDirectory()
    );
    if (!target) {
      return undefined;
    }

    await vscode.workspace.fs.createDirectory(target.directory);
    await vscode.workspace.fs.writeFile(target.file, bytes);
    await this.options.showImagePreview(target.file, document);

    const edit = new vscode.DocumentPasteEdit(
      formatImageReference(target.referencePath, this.options.getImageReferenceStyle()),
      'Insert pasted image reference',
      vscode.DocumentDropOrPasteEditKind.Text
    );

    return ranges.length ? [edit] : undefined;
  }
}

function getFirstImage(dataTransfer: vscode.DataTransfer): vscode.DataTransferItem | undefined {
  for (const mime of imagePasteMimeTypes) {
    const item = dataTransfer.get(mime);
    if (item) {
      return item;
    }
  }

  return undefined;
}

function getImageTarget(root: vscode.Uri | undefined, imageDirectory: string): ImageTarget | undefined {
  if (!root) {
    return undefined;
  }

  const directory = vscode.Uri.joinPath(root, ...imageDirectory.split('/'));
  const fileName = createImageFileName();
  return {
    directory,
    file: vscode.Uri.joinPath(directory, fileName),
    referencePath: `${imageDirectory}/${fileName}`
  };
}
