export type AgentCompletionValue = string | string[];

export type AgentCompletionConfig = string[] | Record<string, AgentCompletionValue>;

export type AgentCompletion = {
  alias: string;
  insertText: string;
};

export function normalizeAgentCompletions(
  config: AgentCompletionConfig,
  activePrefix: '$' | '/'
): AgentCompletion[] {
  if (Array.isArray(config)) {
    return config
      .map((completion) => normalizeAgentCompletion(completion, completion, activePrefix))
      .filter((completion): completion is AgentCompletion => Boolean(completion));
  }

  if (typeof config === 'object' && config) {
    return Object.entries(config)
      .flatMap(([alias, insertText]) => {
        const insertTexts = Array.isArray(insertText) ? insertText : [insertText];
        return insertTexts.map((value) => normalizeAgentCompletion(alias, value, activePrefix));
      })
      .filter((completion): completion is AgentCompletion => Boolean(completion));
  }

  return [];
}

export function dedupeAgentCompletions(completions: AgentCompletion[]): AgentCompletion[] {
  return completions.filter((completion, index) => {
    return completions.findIndex((candidate) => {
      return candidate.alias === completion.alias && candidate.insertText === completion.insertText;
    }) === index;
  });
}

export function getAgentCompletionMatchScore(
  query: string,
  completion: AgentCompletion
): number | undefined {
  if (!query) {
    return 0;
  }

  const aliasScore = getFuzzyMatchScore(query, completion.alias.slice(1));
  const insertTextScore = getFuzzyMatchScore(query, completion.insertText.slice(1));
  const scores = [aliasScore, insertTextScore].filter((score): score is number => score !== undefined);
  return scores.length ? Math.min(...scores) : undefined;
}

export function getFuzzyMatchScore(query: string, target: string): number | undefined {
  const normalizedQuery = normalizeFuzzyText(query);
  const normalizedTarget = normalizeFuzzyText(target);

  if (!normalizedQuery) {
    return 0;
  }

  if (!normalizedTarget) {
    return undefined;
  }

  if (normalizedTarget.startsWith(normalizedQuery)) {
    return normalizedTarget.length - normalizedQuery.length;
  }

  const index = normalizedTarget.indexOf(normalizedQuery);
  if (index >= 0) {
    return 50 + index;
  }

  let targetIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let gapScore = 0;

  for (const char of normalizedQuery) {
    const matchIndex = normalizedTarget.indexOf(char, targetIndex);
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

  return 100 + firstMatchIndex + gapScore;
}

function normalizeAgentCompletion(
  alias: string,
  insertText: string,
  activePrefix: '$' | '/'
): AgentCompletion | undefined {
  const normalizedAlias = normalizeAgentCompletionText(alias, activePrefix);
  const normalizedInsertText = normalizeAgentCompletionText(insertText, activePrefix);
  if (!normalizedAlias || !normalizedInsertText) {
    return undefined;
  }

  return {
    alias: normalizedAlias,
    insertText: normalizedInsertText
  };
}

function normalizeAgentCompletionText(text: string, activePrefix: '$' | '/'): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('$') || trimmed.startsWith('/')) {
    return trimmed.startsWith(activePrefix) ? trimmed : undefined;
  }

  return `${activePrefix}${trimmed}`;
}

function normalizeFuzzyText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}
