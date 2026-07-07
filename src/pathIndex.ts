export type PathIndex = {
  filesByPath: string[];
  filesByBasename: string[];
  directoriesByPath: string[];
  directoriesByName: string[];
};

export type PathCompletionMode = 'path' | 'file' | 'directory';

export type PathCompletionQuery = {
  mode: PathCompletionMode;
  query: string;
};

const pathOperatorPattern = /^([fd]):(.*)$/;

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
    return searchByFuzzyMatch(index.filesByBasename, query.query, getBasename, limit);
  }

  if (query.mode === 'directory') {
    return searchByFuzzyMatch(index.directoriesByName, query.query, getBasename, limit);
  }

  return searchByFuzzyMatch(index.filesByPath, query.query, (path) => path, limit);
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

function searchByFuzzyMatch(
  values: string[],
  query: string,
  keySelector: (value: string) => string,
  limit: number
): string[] {
  const normalizedQuery = getSearchKey(query);
  if (!normalizedQuery) {
    return values.slice(0, limit);
  }

  return values
    .map((value, index) => {
      return {
        value,
        index,
        score: getFuzzyMatchScore(normalizedQuery, keySelector(value))
      };
    })
    .filter((match): match is { value: string; index: number; score: number } => match.score !== undefined)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.value);
}

function getFuzzyMatchScore(normalizedQuery: string, target: string): number | undefined {
  const normalizedTarget = getSearchKey(target);

  if (normalizedTarget === normalizedQuery) {
    return -200;
  }

  if (normalizedTarget.startsWith(normalizedQuery)) {
    return -100 + target.length - normalizedQuery.length;
  }

  const contiguousIndex = normalizedTarget.indexOf(normalizedQuery);
  if (contiguousIndex >= 0) {
    return 50 + contiguousIndex * 4 + target.length - normalizedQuery.length;
  }

  const subsequenceScore = getFuzzySubsequenceScore(normalizedQuery, target, normalizedTarget);
  if (subsequenceScore === undefined) {
    return undefined;
  }

  return 300 + target.length - normalizedQuery.length + subsequenceScore;
}

function getFuzzySubsequenceScore(
  normalizedQuery: string,
  target: string,
  normalizedTarget: string
): number | undefined {
  const memo = new Map<string, number | undefined>();

  function findBest(queryIndex: number, previousMatchIndex: number): number | undefined {
    if (queryIndex >= normalizedQuery.length) {
      return 0;
    }

    const memoKey = `${queryIndex}:${previousMatchIndex}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }

    let bestScore: number | undefined;
    const queryChar = normalizedQuery[queryIndex];

    for (let index = previousMatchIndex + 1; index < normalizedTarget.length; index += 1) {
      if (normalizedTarget[index] !== queryChar) {
        continue;
      }

      const restScore = findBest(queryIndex + 1, index);
      if (restScore === undefined) {
        continue;
      }

      const distanceScore = previousMatchIndex < 0
        ? index * 4
        : (index - previousMatchIndex - 1) * 12;
      const boundaryBonus = getBoundaryBonus(target, index);
      const uppercaseBonus = isUppercaseLetter(target[index]) ? 40 : 0;
      const score = distanceScore - boundaryBonus - uppercaseBonus + restScore;

      if (bestScore === undefined || score < bestScore) {
        bestScore = score;
      }
    }

    memo.set(memoKey, bestScore);
    return bestScore;
  }

  return findBest(0, -1);
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

function getBoundaryBonus(target: string, index: number): number {
  if (index === 0) {
    return 120;
  }

  const previous = target[index - 1];
  if (previous === '/') {
    return 120;
  }

  if (previous === '-' || previous === '_' || previous === '.') {
    return 50;
  }

  if (isLowercaseLetter(previous) && isUppercaseLetter(target[index])) {
    return 100;
  }

  return 0;
}

function isUppercaseLetter(char: string): boolean {
  return char >= 'A' && char <= 'Z';
}

function isLowercaseLetter(char: string): boolean {
  return char >= 'a' && char <= 'z';
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
  return 'directory';
}
