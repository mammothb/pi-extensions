/** Common English stop words filtered from search queries. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "each",
  "every",
  "few",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "just",
  "many",
  "more",
  "most",
  "much",
  "new",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "other",
  "over",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "these",
  "they",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "who",
  "will",
  "with",
  "would",
]);

export interface SearchResult {
  key: string;
  valuePreview: string;
  score: number;
}

/** Tokenize a string into lowercase non-stop words. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Score a memory entry against a query.
 * +3 per word match in key, +1 per word match in value.
 * Bonus: +5 if all query words appear in sequence in the key (phrase match).
 */
function scoreEntry(queryWords: string[], key: string, value: string): number {
  const keyLower = key.toLowerCase();
  const valueLower = value.toLowerCase();
  let score = 0;

  let allMatched = true;
  for (const word of queryWords) {
    const inKey = keyLower.includes(word);
    const inValue = valueLower.includes(word);

    if (inKey) {
      score += 3;
    } else if (inValue) {
      score += 1;
    } else {
      allMatched = false;
    }
  }

  // Phrase match bonus: all query words in sequence in the key
  if (
    allMatched &&
    queryWords.length >= 2 &&
    keyLower.includes(queryWords.join(" "))
  ) {
    score += 5;
  }

  return score;
}

const MAX_PREVIEW = 200;

/** Search memory entries by keyword, returning top N results by score. */
export function searchMemory(
  memory: Record<string, string>,
  query: string,
  limit = 5,
): SearchResult[] {
  const queryWords = tokenize(query);
  if (queryWords.length === 0) return [];

  const results: SearchResult[] = [];

  for (const [key, value] of Object.entries(memory)) {
    const score = scoreEntry(queryWords, key, value);
    if (score > 0) {
      results.push({
        key,
        valuePreview:
          value.length > MAX_PREVIEW
            ? `${value.slice(0, MAX_PREVIEW)}…`
            : value,
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
