export type BrowserSafetyViolation = { rule: string; line: number }

const RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'node: import', pattern: /(?:from\s+|import\s*\(?\s*|require\(\s*)['"]node:/ },
  {
    rule: 'bun import',
    pattern: /(?:from\s+|import\s*\(?\s*|require\(\s*)['"]bun(?::[^'"]*)?['"]/,
  },
  { rule: 'Bun global', pattern: /\bBun\./ },
  { rule: 'process global', pattern: /\bprocess\./ },
  { rule: 'harness import', pattern: /['"]@dltech\/atlas-harness(?:\/[^'"]*)?['"]/ },
  { rule: 'wire root import', pattern: /['"]@dltech\/atlas-wire['"]/ },
  { rule: '@vercel/sandbox import', pattern: /['"]@vercel\/sandbox(?:\/[^'"]*)?['"]/ },
  {
    rule: 'relative .js import',
    pattern: /(?:from\s+|import\s*\(?\s*)['"]\.{1,2}\/[^'"]*\.js['"]/,
  },
]

export const browserSafetyViolations = (source: string): BrowserSafetyViolation[] =>
  source.split('\n').flatMap((text, index) =>
    RULES.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => ({
      rule,
      line: index + 1,
    })),
  )
