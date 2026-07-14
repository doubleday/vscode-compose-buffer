import * as path from 'path';

export type CommitBehavior = 'copyAndPaste' | 'copyOnly';
export type ImageReferenceStyle = 'atPath' | 'path';

export function normalizeWorkspacePath(filePath: string): string {
  return filePath.split(path.sep).join('/').replace(/\\/g, '/');
}

export function normalizeImageDirectory(imageDirectory: string): string {
  const trimmed = imageDirectory.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  return normalizeWorkspacePath(trimmed || '.images');
}

export function createImageFileName(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${stamp}.png`;
}

export function formatImageReference(relativePath: string, style: ImageReferenceStyle): string {
  const normalized = normalizeWorkspacePath(relativePath);
  return style === 'atPath' ? `@${normalized}` : normalized;
}

export function shouldSendToTerminal(behavior: CommitBehavior, hasTerminal: boolean): boolean {
  return behavior === 'copyAndPaste' && hasTerminal;
}

export function formatPathTail(filePath: string, maxLength: number): string {
  const normalized = normalizeWorkspacePath(filePath).replace(/\/+$/, '');
  if (maxLength <= 0) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return '.'.repeat(maxLength);
  }
  return `...${normalized.slice(-(maxLength - 3))}`;
}
