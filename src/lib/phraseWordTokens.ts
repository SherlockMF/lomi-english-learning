export function phraseWordKey(word: string): string {
  const normalized = word.normalize('NFKC').replaceAll('’', "'").replace(/[‐‑]/gu, '-')
  return /^[A-Z][A-Z\d]+$/.test(normalized) ? normalized : normalized.toLowerCase()
}

export function phraseWordTokens(expression: string) {
  const tokens = Array.from(expression.matchAll(/[\p{Script=Latin}\p{Mark}\d]+(?:['’\-‐‑][\p{Script=Latin}\p{Mark}\d]+)*/gu))
    .filter(match => /\p{Script=Latin}/u.test(match[0]))
    .map(match => ({ word: match[0], start: match.index, end: match.index + match[0].length }))
  return tokens.length > 1 ? tokens : []
}
