export type PathIndex = {
  filesByPath: string[];
  filesByBasename: string[];
  directoriesByPath: string[];
  directoriesByName: string[];
};

export type PathSearchResult = {
  path: string;
  isDirectory: boolean;
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
  return searchPathIndexWithTypes(index, query, limit).map((result) => result.path);
}

export function searchPathIndexWithTypes(
  index: PathIndex,
  query: PathCompletionQuery,
  limit: number
): PathSearchResult[] {
  if (limit <= 0) {
    return [];
  }

  if (query.mode === 'file') {
    return searchByFuzzyMatch(index.filesByBasename, query.query, getBasename, limit)
      .map((path) => ({ path, isDirectory: false }));
  }

  if (query.mode === 'directory') {
    return searchByFuzzyMatch(index.directoriesByName, query.query, getBasename, limit)
      .map((path) => ({ path, isDirectory: true }));
  }

  return searchFilesAndDirectories(index.filesByPath, index.directoriesByPath, query.query, limit);
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
        rank: getFuzzyMatchRank(normalizedQuery, keySelector(value))
      };
    })
    .filter((match): match is { value: string; index: number; rank: number[] } => match.rank !== undefined)
    .sort((a, b) => compareRanks(a.rank, b.rank) || a.index - b.index)
    .slice(0, limit)
    .map((match) => match.value);
}

function searchFilesAndDirectories(
  files: string[],
  directories: string[],
  query: string,
  limit: number
): PathSearchResult[] {
  const normalizedQuery = getSearchKey(query);
  const continuedDirectory = normalizedQuery.endsWith('/')
    ? normalizedQuery.replace(/\/+$/, '')
    : undefined;
  if (!normalizedQuery) {
    return [
      ...files.map((path) => ({ path, isDirectory: false })),
      ...directories.map((path) => ({ path, isDirectory: true }))
    ].slice(0, limit);
  }

  return [
    ...files.map((path, index) => ({ path, isDirectory: false, index })),
    ...directories.map((path, index) => ({ path, isDirectory: true, index }))
  ]
    .filter((candidate) => {
      return !candidate.isDirectory || getSearchKey(candidate.path) !== continuedDirectory;
    })
    .map((candidate) => ({
      ...candidate,
      rank: getFuzzyMatchRank(normalizedQuery, candidate.path),
      directRank: getFuzzyMatchRank(normalizedQuery, getBasename(candidate.path))
    }))
    .filter((candidate): candidate is PathSearchResult & {
      index: number;
      rank: number[];
      directRank: number[] | undefined;
    } => {
      return candidate.rank !== undefined;
    })
    .sort((a, b) => {
      const directnessComparison = Number(!a.directRank) - Number(!b.directRank);
      if (directnessComparison) {
        return directnessComparison;
      }

      const primaryRankA = a.directRank ?? a.rank;
      const primaryRankB = b.directRank ?? b.rank;
      const primaryClassComparison = primaryRankA[0] - primaryRankB[0];
      const primarySemanticComparison = compareMatchSemantics(primaryRankA, primaryRankB);
      const matchClassComparison = a.rank[0] - b.rank[0];
      const semanticComparison = compareMatchSemantics(a.rank, b.rank);
      const typeComparison = Number(a.isDirectory) - Number(b.isDirectory);
      return primaryClassComparison
        || primarySemanticComparison
        || matchClassComparison
        || semanticComparison
        || typeComparison
        || compareRanks(primaryRankA, primaryRankB)
        || compareRanks(a.rank, b.rank)
        || a.index - b.index;
    })
    .slice(0, limit)
    .map(({ path, isDirectory }) => ({ path, isDirectory }));
}

function compareMatchSemantics(a: number[], b: number[]): number {
  if (a[0] === 1 || b[0] === 1) {
    return compareRanks(a, b);
  }
  return compareRanks(a.slice(1, -1), b.slice(1, -1));
}

function getFuzzyMatchRank(normalizedQuery: string, target: string): number[] | undefined {
  const normalizedTarget = getSearchKey(target);

  if (normalizedTarget === normalizedQuery) {
    return [0];
  }

  if (normalizedQuery.includes('/')) {
    const pathElementRank = getPathElementMatchRank(normalizedQuery, target);
    return pathElementRank ? [1, ...pathElementRank] : undefined;
  }

  const wordPrefixMatch = getWordPrefixMatch(normalizedQuery, target);
  if (wordPrefixMatch) {
    return [2, -wordPrefixMatch.wordCount, wordPrefixMatch.startWordIndex, target.length];
  }

  const contiguousIndex = normalizedTarget.indexOf(normalizedQuery);
  if (contiguousIndex >= 0) {
    return [3, contiguousIndex, target.length];
  }

  const subsequenceMatch = getFuzzySubsequenceMatch(normalizedQuery, target, normalizedTarget);
  if (!subsequenceMatch) {
    return undefined;
  }

  return [
    4,
    -subsequenceMatch.boundaryMatches,
    subsequenceMatch.totalGap,
    subsequenceMatch.firstMatchIndex,
    target.length
  ];
}

function getPathElementMatchRank(normalizedQuery: string, target: string): number[] | undefined {
  const queryElements = normalizedQuery.replace(/\/+$/, '').split('/');
  const targetElements = target.split('/');
  if (queryElements.some((element) => !element) || queryElements.length > targetElements.length) {
    return undefined;
  }

  let bestRank: number[] | undefined;
  for (let startIndex = 0; startIndex <= targetElements.length - queryElements.length; startIndex += 1) {
    const elementRanks: number[][] = [];
    for (let index = 0; index < queryElements.length; index += 1) {
      const rank = getFuzzyMatchRank(queryElements[index], targetElements[startIndex + index]);
      if (!rank) {
        elementRanks.length = 0;
        break;
      }
      elementRanks.push(rank);
    }
    if (!elementRanks.length) {
      continue;
    }

    const matchClasses = elementRanks.map((rank) => rank[0]);
    const trailingElementCount = targetElements.length - (startIndex + queryElements.length);
    const rank = [
      Math.max(...matchClasses),
      matchClasses.reduce((sum, matchClass) => sum + matchClass, 0),
      startIndex,
      trailingElementCount,
      ...elementRanks.flatMap((elementRank) => [elementRank.length, ...elementRank])
    ];
    if (!bestRank || compareRanks(rank, bestRank) < 0) {
      bestRank = rank;
    }
  }
  return bestRank;
}

type SubsequenceMatch = {
  boundaryMatches: number;
  totalGap: number;
  firstMatchIndex: number;
};

function getFuzzySubsequenceMatch(
  normalizedQuery: string,
  target: string,
  normalizedTarget: string
): SubsequenceMatch | undefined {
  const memo = new Map<string, SubsequenceMatch | undefined>();

  function findBest(queryIndex: number, previousMatchIndex: number): SubsequenceMatch | undefined {
    if (queryIndex >= normalizedQuery.length) {
      return { boundaryMatches: 0, totalGap: 0, firstMatchIndex: previousMatchIndex };
    }

    const memoKey = `${queryIndex}:${previousMatchIndex}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }

    let bestMatch: SubsequenceMatch | undefined;
    const queryChar = normalizedQuery[queryIndex];

    for (let index = previousMatchIndex + 1; index < normalizedTarget.length; index += 1) {
      if (normalizedTarget[index] !== queryChar) {
        continue;
      }

      const restMatch = findBest(queryIndex + 1, index);
      if (!restMatch) {
        continue;
      }

      const match = {
        boundaryMatches: restMatch.boundaryMatches + (isWordBoundary(target, index) ? 1 : 0),
        totalGap: restMatch.totalGap + (previousMatchIndex < 0 ? 0 : index - previousMatchIndex - 1),
        firstMatchIndex: previousMatchIndex < 0 ? index : restMatch.firstMatchIndex
      };

      if (!bestMatch || compareSubsequenceMatches(match, bestMatch) < 0) {
        bestMatch = match;
      }
    }

    memo.set(memoKey, bestMatch);
    return bestMatch;
  }

  return findBest(0, -1);
}

function getWordPrefixMatch(
  normalizedQuery: string,
  target: string
): { wordCount: number; startWordIndex: number } | undefined {
  const words = getWords(withoutFileExtension(target)).map(getSearchKey);
  const memo = new Map<string, number | undefined>();

  function findEndWordIndex(wordIndex: number, queryIndex: number): number | undefined {
    if (queryIndex === normalizedQuery.length) {
      return wordIndex;
    }
    if (wordIndex >= words.length) {
      return undefined;
    }

    const memoKey = `${wordIndex}:${queryIndex}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey);
    }

    let best: number | undefined;
    const word = words[wordIndex];
    const remaining = normalizedQuery.length - queryIndex;
    for (let length = 1; length <= Math.min(word.length, remaining); length += 1) {
      if (word.slice(0, length) !== normalizedQuery.slice(queryIndex, queryIndex + length)) {
        break;
      }
      const endWordIndex = findEndWordIndex(wordIndex + 1, queryIndex + length);
      if (endWordIndex !== undefined && (best === undefined || endWordIndex > best)) {
        best = endWordIndex;
      }
    }

    memo.set(memoKey, best);
    return best;
  }

  let bestMatch: { wordCount: number; startWordIndex: number } | undefined;
  for (let startWordIndex = 0; startWordIndex < words.length; startWordIndex += 1) {
    const endWordIndex = findEndWordIndex(startWordIndex, 0);
    if (endWordIndex === undefined) {
      continue;
    }
    const match = { wordCount: endWordIndex - startWordIndex, startWordIndex };
    if (!bestMatch
      || match.wordCount > bestMatch.wordCount
      || (match.wordCount === bestMatch.wordCount && match.startWordIndex < bestMatch.startWordIndex)) {
      bestMatch = match;
    }
  }
  return bestMatch;
}

function withoutFileExtension(target: string): string {
  const lastSlash = target.lastIndexOf('/');
  const lastDot = target.lastIndexOf('.');
  return lastDot > lastSlash + 1 ? target.slice(0, lastDot) : target;
}

function getWords(target: string): string[] {
  return target.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z]?[a-z]+|[A-Z]+|\d+/g) ?? [];
}

function compareRanks(a: number[], b: number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

function compareSubsequenceMatches(a: SubsequenceMatch, b: SubsequenceMatch): number {
  return compareRanks(
    [-a.boundaryMatches, a.totalGap, a.firstMatchIndex],
    [-b.boundaryMatches, b.totalGap, b.firstMatchIndex]
  );
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

function isWordBoundary(target: string, index: number): boolean {
  if (index === 0) {
    return true;
  }

  const previous = target[index - 1];
  return previous === '/'
    || previous === '-'
    || previous === '_'
    || previous === '.'
    || (isLowercaseLetter(previous) && isUppercaseLetter(target[index]));
}

function isLowercaseLetter(char: string): boolean {
  return char >= 'a' && char <= 'z';
}

function isUppercaseLetter(char: string): boolean {
  return char >= 'A' && char <= 'Z';
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
