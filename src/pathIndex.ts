export type PathIndex = {
  filesByPath: string[];
  filesByBasename: string[];
  directoriesByPath: string[];
  directoriesByName: string[];
};

export type PathCompletionMode = 'path' | 'file' | 'directory' | 'fuzzy';

export type PathCompletionQuery = {
  mode: PathCompletionMode;
  query: string;
};

const pathOperatorPattern = /^([fd?]):(.*)$/;

export function createPathIndex(paths: string[]): PathIndex {
  const files = Array.from(new Set(paths.map(normalizeIndexPath).filter(Boolean)));
  const directories = new Set<string>();

  for (const file of files) {
    for (const directory of getParentDirectories(file)) {
      directories.add(directory);
    }
  }

  return {
    filesByPath: sortByKey(files, getSearchKey),
    filesByBasename: sortByKey(files, (file) => getSearchKey(getBasename(file)) || getSearchKey(file)),
    directoriesByPath: sortByKey(Array.from(directories), getSearchKey),
    directoriesByName: sortByKey(Array.from(directories), (directory) => getSearchKey(getBasename(directory)) || getSearchKey(directory))
  };
}

export function parsePathCompletionQuery(text: string): PathCompletionQuery {
  const match = pathOperatorPattern.exec(text);
  if (!match) {
    return {
      mode: 'path',
      query: normalizeQueryPath(text)
    };
  }

  const mode = getOperatorMode(match[1]);
  return {
    mode,
    query: mode === 'path' ? normalizeQueryPath(match[2]) : normalizeIndexPath(match[2])
  };
}

export function searchPathIndex(index: PathIndex, query: PathCompletionQuery, limit: number): string[] {
  if (limit <= 0) {
    return [];
  }

  if (query.mode === 'file') {
    return searchByPrefix(index.filesByBasename, query.query, getBasename, limit);
  }

  if (query.mode === 'directory') {
    return searchByPrefix(index.directoriesByName, query.query, getBasename, limit);
  }

  if (query.mode === 'fuzzy') {
    return searchBySubsequence(index.filesByBasename, query.query, limit);
  }

  return searchByPrefix(index.filesByPath, query.query, (path) => path, limit);
}

export function getShortestUniquePathSuffix(filePath: string, candidates: string[]): string {
  const normalizedPath = normalizeIndexPath(filePath);
  const parts = normalizedPath.split('/').filter(Boolean);
  const normalizedCandidates = candidates.map(normalizeIndexPath).filter(Boolean);

  for (let length = 1; length <= parts.length; length += 1) {
    const suffix = parts.slice(parts.length - length).join('/');
    const suffixKey = getSearchKey(suffix);
    const matchingCandidates = normalizedCandidates.filter((candidate) => {
      return getSearchKey(candidate) === suffixKey || getSearchKey(candidate).endsWith(`/${suffixKey}`);
    });

    if (matchingCandidates.length === 1) {
      return suffix;
    }
  }

  return normalizedPath;
}

export function normalizeIndexPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizeQueryPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function searchByPrefix(
  values: string[],
  query: string,
  keySelector: (value: string) => string,
  limit: number
): string[] {
  const normalizedQuery = getSearchKey(query);
  if (!normalizedQuery) {
    return values.slice(0, limit);
  }

  const start = lowerBound(values, normalizedQuery, keySelector);
  const results: string[] = [];

  for (let index = start; index < values.length && results.length < limit; index += 1) {
    const value = values[index];
    if (!getSearchKey(keySelector(value)).startsWith(normalizedQuery)) {
      break;
    }
    results.push(value);
  }

  return results;
}

function searchBySubsequence(values: string[], query: string, limit: number): string[] {
  const normalizedQuery = getSearchKey(query);
  if (!normalizedQuery) {
    return values.slice(0, limit);
  }

  return values
    .map((value, index) => {
      return {
        value,
        index,
        score: getFuzzyPathMatchScore(normalizedQuery, value)
      };
    })
    .filter((match): match is { value: string; index: number; score: number } => match.score !== undefined)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.value);
}

function getFuzzyPathMatchScore(normalizedQuery: string, value: string): number | undefined {
  const basename = getSearchKey(getBasename(value));
  const path = getSearchKey(value);
  const basenameScore = getFuzzyMatchScore(normalizedQuery, basename);
  const pathScore = getFuzzyMatchScore(normalizedQuery, path);

  if (basenameScore !== undefined) {
    return basenameScore;
  }

  if (pathScore !== undefined) {
    return 1000 + pathScore;
  }

  return undefined;
}

function getFuzzyMatchScore(normalizedQuery: string, target: string): number | undefined {
  if (target.startsWith(normalizedQuery)) {
    return target.length - normalizedQuery.length;
  }

  const contiguousIndex = target.indexOf(normalizedQuery);
  if (contiguousIndex >= 0) {
    return 100 + contiguousIndex + target.length - normalizedQuery.length;
  }

  let targetIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let gapScore = 0;

  for (const char of normalizedQuery) {
    const matchIndex = target.indexOf(char, targetIndex);
    if (matchIndex < 0) {
      return undefined;
    }

    if (firstMatchIndex < 0) {
      firstMatchIndex = matchIndex;
    }
    if (lastMatchIndex >= 0) {
      gapScore += matchIndex - lastMatchIndex - 1;
    }

    lastMatchIndex = matchIndex;
    targetIndex = matchIndex + 1;
  }

  return 500 + firstMatchIndex + gapScore + target.length - normalizedQuery.length;
}

function lowerBound(values: string[], query: string, keySelector: (value: string) => string): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (getSearchKey(keySelector(values[mid])) < query) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function sortByKey(values: string[], keySelector: (value: string) => string): string[] {
  return [...values].sort((a, b) => {
    const keyComparison = keySelector(a).localeCompare(keySelector(b));
    return keyComparison || a.localeCompare(b);
  });
}

function getSearchKey(value: string): string {
  return value.toLowerCase();
}

function getBasename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index >= 0 ? filePath.slice(index + 1) : filePath;
}

function getParentDirectories(filePath: string): string[] {
  const directories: string[] = [];
  let end = filePath.lastIndexOf('/');

  while (end > 0) {
    const directory = filePath.slice(0, end);
    directories.push(directory);
    end = directory.lastIndexOf('/');
  }

  return directories;
}

function getOperatorMode(operator: string): PathCompletionMode {
  if (operator === 'f') {
    return 'file';
  }
  if (operator === 'd') {
    return 'directory';
  }
  return 'fuzzy';
}
