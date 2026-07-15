# Publishing

This extension is published from GitHub Actions when a version tag is pushed.
The same release workflow also uploads the generated `.vsix` file to the
GitHub Release.

## Moving Parts

- VS Code Marketplace hosts the published extension.
- Azure DevOps provides the publishing token used by `vsce`.
- GitHub Actions stores that token as `VSCE_PAT` and runs the release workflow.
- `package.json` defines the extension identity: `publisher`, `name`, and
  `version`.
- `.vscodeignore` controls what files are included in the Marketplace package.

The extension identity is:

```text
DanielDoubleday.compose-buffer
```

Changing either `publisher` or `name` creates a different Marketplace extension
identity, so treat those fields as stable after the first public publish.

## Important URLs

- Marketplace publisher management:
  https://marketplace.visualstudio.com/manage/publishers/
- Published extension page:
  https://marketplace.visualstudio.com/items?itemName=DanielDoubleday.compose-buffer
- Azure DevOps:
  https://dev.azure.com/
- Azure DevOps personal access tokens:
  https://dev.azure.com/_usersSettings/tokens
- GitHub Actions secrets for this repo:
  https://github.com/doubleday/vscode-compose-buffer/settings/secrets/actions
- GitHub Actions release workflow:
  https://github.com/doubleday/vscode-compose-buffer/actions/workflows/release.yml
- GitHub releases:
  https://github.com/doubleday/vscode-compose-buffer/releases
- Official VS Code publishing docs:
  https://code.visualstudio.com/api/working-with-extensions/publishing-extension

## One-Time Setup

1. Create or open the Marketplace publisher in the Visual Studio Marketplace.
2. Create an Azure DevOps personal access token.
3. Give the token the `Marketplace: Manage` scope.
4. Add the token to this GitHub repository as an Actions secret named
   `VSCE_PAT`.

The GitHub secret name must match the workflow exactly:

```text
VSCE_PAT
```

Do not commit the token to the repository.

## Release Workflow

Before releasing, make sure the local package still builds and contains only the
expected files:

```sh
npm run check
npm run package
```

Then commit the release-ready changes:

```sh
git add .github/workflows/release.yml .vscodeignore package.json package-lock.json docs/publishing.md README.md
git commit -m "Document Marketplace publishing"
git push
```

Cut a new version and push the generated tag:

```sh
npm version patch
git push --follow-tags
```

`npm version patch` updates `package.json` and `package-lock.json`, creates a
Git commit, and creates a tag like `v0.0.6`.

Pushing the tag starts `.github/workflows/release.yml`, which:

1. Installs dependencies with `npm ci`.
2. Runs `npm run check`.
3. Builds the VSIX with `npm run package`.
4. Publishes the VSIX to the VS Code Marketplace using `VSCE_PAT`.
5. Creates or updates the matching GitHub Release with the same VSIX.

## Manual Packaging

To build a local VSIX without publishing:

```sh
npm run package
```

To install the local package into VS Code:

```sh
code --install-extension compose-buffer-*.vsix --force
```

The generated `.vsix` files are ignored by git and excluded from Marketplace
packages.

## Troubleshooting

If the workflow fails with an authentication error, check that `VSCE_PAT` exists
in GitHub Actions secrets and that the Azure DevOps token has not expired.

If publishing fails because the publisher is unknown or unauthorized, confirm
that the `publisher` field in `package.json` exactly matches the Marketplace
publisher ID and that the token's Microsoft account has access to that
publisher.

If the Marketplace package includes local workspace files, run:

```sh
npm run package
```

Then inspect the "Files included in the VSIX" output and add unwanted paths to
`.vscodeignore`.

Microsoft has announced that global Azure DevOps personal access tokens retire
on December 1, 2026. The current workflow uses `VSCE_PAT`; it may need to move
to Microsoft Entra ID based publishing before that date.
