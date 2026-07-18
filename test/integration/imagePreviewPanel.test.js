const assert = require('node:assert/strict');
const vscode = require('vscode');
const { ImagePreviewPanel } = require('../../dist/imagePreviewPanel');

const previewViewType = 'composeBuffer.imagePreview';

suite('Image preview panel', () => {
  let preview;

  suiteSetup(async () => {
    await vscode.workspace.fs.writeFile(firstImageUri(), transparentPng());
    await vscode.workspace.fs.writeFile(secondImageUri(), transparentPng());
  });

  suiteTeardown(async () => {
    await vscode.workspace.fs.delete(firstImageUri());
    await vscode.workspace.fs.delete(secondImageUri());
  });

  teardown(async () => {
    preview?.dispose();
    preview = undefined;
    await waitFor(() => !findPreviewTab());
  });

  test('collects images in one gallery tab and removes its empty editor group', async () => {
    await closeAdditionalEditorGroups();
    await showBaselineEditor();
    const initialColumns = new Set(vscode.window.tabGroups.all.map((group) => group.viewColumn));
    preview = new ImagePreviewPanel();

    preview.addImage(firstImageUri());
    await waitFor(() => findPreviewTab()?.label === 'Pasted Images (1)');
    const previewGroup = findPreviewGroup();
    assert.ok(previewGroup);
    assert.equal(initialColumns.has(previewGroup.viewColumn), false);

    preview.addImage(secondImageUri());
    await waitFor(() => findPreviewTab()?.label === 'Pasted Images (2)');
    assert.equal(findPreviewGroup()?.tabs.filter(isPreviewTab).length, 1);

    const previewColumn = previewGroup.viewColumn;
    preview.dispose();
    preview = undefined;

    await waitFor(() => !findPreviewTab());
    await waitFor(() => !vscode.window.tabGroups.all.some(
      (group) => group.viewColumn === previewColumn
    ));
  });

  test('keeps a gallery-created group when the user opens another editor in it', async () => {
    preview = new ImagePreviewPanel();
    preview.addImage(firstImageUri());
    await waitFor(() => Boolean(findPreviewTab()));
    const previewGroup = findPreviewGroup();
    assert.ok(previewGroup);

    const document = await vscode.workspace.openTextDocument({ content: 'Keep this editor open.' });
    await vscode.window.showTextDocument(document, {
      viewColumn: previewGroup.viewColumn,
      preview: false,
      preserveFocus: true
    });
    await waitFor(() => previewGroup.tabs.some((tab) => tab.input instanceof vscode.TabInputText));

    const previewColumn = previewGroup.viewColumn;
    preview.dispose();
    preview = undefined;

    await waitFor(() => !findPreviewTab());
    assert.ok(vscode.window.tabGroups.all.some(
      (group) => group.viewColumn === previewColumn && group.tabs.some(
        (tab) => tab.input instanceof vscode.TabInputText
      )
    ));
  });
});

function workspaceUri() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'integration tests require a workspace folder');
  return folder.uri;
}

function findPreviewGroup() {
  return vscode.window.tabGroups.all.find((group) => group.tabs.some(isPreviewTab));
}

function findPreviewTab() {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs).find(isPreviewTab);
}

function isPreviewTab(tab) {
  return tab.label.startsWith('Pasted Images')
    && tab.input instanceof vscode.TabInputWebview
    && tab.input.viewType.endsWith(previewViewType);
}

function firstImageUri() {
  return vscode.Uri.joinPath(workspaceUri(), 'first.png');
}

function secondImageUri() {
  return vscode.Uri.joinPath(workspaceUri(), 'second.png');
}

function transparentPng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+XQAAAABJRU5ErkJggg==',
    'base64'
  );
}

async function waitFor(predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for VS Code state to update.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function closeAdditionalEditorGroups() {
  const additionalGroups = vscode.window.tabGroups.all.filter(
    (group) => group.viewColumn !== vscode.ViewColumn.One
  );
  if (additionalGroups.length > 0) {
    await vscode.window.tabGroups.close(additionalGroups, true);
  }
  await waitFor(() => vscode.window.tabGroups.all.length === 1);
}

async function showBaselineEditor() {
  const document = await vscode.workspace.openTextDocument({ content: 'Baseline editor.' });
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preview: false
  });
}
