export type SplitRule = {
  readonly name: string
  readonly roots: readonly string[]
  readonly forbidden: readonly string[]
}

export type Violation = {
  readonly file: string
  readonly specifier: string
  readonly rule: string
}

export type AllowedViolation = { readonly file: string; readonly specifier: string }

const SPECIFIER_PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

export const specifiersOf = (text: string): string[] =>
  SPECIFIER_PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1] ?? ''),
  )

const isForbidden = (specifier: string, forbidden: readonly string[]): boolean =>
  forbidden.some((name) => specifier === name || specifier.startsWith(`${name}/`))

const isUnder = (file: string, roots: readonly string[]): boolean =>
  roots.some((root) => file.startsWith(`${root}/`))

export const violationsOf = (args: {
  files: ReadonlyMap<string, string>
  rules: readonly SplitRule[]
}): Violation[] =>
  [...args.files].flatMap(([file, text]) =>
    args.rules
      .filter((rule) => isUnder(file, rule.roots))
      .flatMap((rule) =>
        specifiersOf(text)
          .filter((specifier) => isForbidden(specifier, rule.forbidden))
          .map((specifier) => ({ file, specifier, rule: rule.name })),
      ),
  )

const sameEntry = (a: AllowedViolation, b: AllowedViolation): boolean =>
  a.file === b.file && a.specifier === b.specifier

export const judge = (args: {
  violations: readonly Violation[]
  allowlist: readonly AllowedViolation[]
}): { forbidden: Violation[]; stale: AllowedViolation[] } => ({
  forbidden: args.violations.filter(
    (violation) => !args.allowlist.some((entry) => sameEntry(entry, violation)),
  ),
  stale: args.allowlist.filter(
    (entry) => !args.violations.some((violation) => sameEntry(entry, violation)),
  ),
})
