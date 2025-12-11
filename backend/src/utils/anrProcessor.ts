import crypto from 'crypto';

export function generateStackTraceHash(stackTrace: string[]): string {
  const normalized = stackTrace
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

export function calculateSimilarity(stackTrace1: string[], stackTrace2: string[]): number {
  const set1 = new Set(stackTrace1.map(line => line.trim()));
  const set2 = new Set(stackTrace2.map(line => line.trim()));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  if (union.size === 0) return 0;

  return (intersection.size / union.size) * 100;
}

export function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

export function calculateLevenshteinSimilarity(stackTrace1: string[], stackTrace2: string[]): number {
  const str1 = stackTrace1.join('\n');
  const str2 = stackTrace2.join('\n');

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  if (maxLength === 0) return 100;

  return ((maxLength - distance) / maxLength) * 100;
}

export function extractStackTracePattern(stackTrace: string[]): string {
  return stackTrace
    .slice(0, 5)
    .map(line => {
      const match = line.match(/at\s+([^(]+)/);
      return match ? match[1].trim() : line.trim();
    })
    .join(' -> ');
}

export const SIMILARITY_THRESHOLD = 70;
