export const REQUIRED_CHECKS_TTL_MS = 60_000

export type GithubBranchRule = {
  type: string
  parameters?: { required_status_checks?: Array<{ context: string }> | null } | null
}

export type GithubClassicRequiredChecks = {
  contexts?: readonly string[] | null
  checks?: Array<{ context: string }> | null
}

export type GithubPathRead = { status: number; body: unknown }

export type RequiredContextsCache = Map<string, { acquiredAt: number; contexts: string[] }>

function asArray<T>(value: readonly T[] | T | null | undefined): readonly T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : []
}

/**
 * The rulesets endpoint and classic branch protection are two independent sources; the branch
 * ruleset that requires `ci` lives only in the first, so both are read and unioned.
 */
export function requiredContextsOf(args: {
  rules: readonly GithubBranchRule[]
  protection: GithubClassicRequiredChecks | null
}): string[] {
  const rules = Array.isArray(args.rules) ? args.rules : []
  const fromRules = rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) =>
      asArray(rule.parameters?.required_status_checks).map((check) => check.context),
    )
  const fromProtection = [
    ...asArray(args.protection?.contexts),
    ...asArray(args.protection?.checks).map((check) => check.context),
  ]
  return [...new Set([...fromRules, ...fromProtection].filter((context) => context.length > 0))]
}

/**
 * Null means neither source could be read, which the writer must keep apart from an answer of no
 * contexts: it stores contexts, so a permission problem or an outage that reads as "requires
 * nothing" would erase a branch's protection and let a verdict settle early.
 */
export async function requiredContextsFrom(args: {
  read: (path: string) => Promise<GithubPathRead>
  owner: string
  repo: string
  branch: string
}): Promise<string[] | null> {
  const branch = encodeURIComponent(args.branch)
  const rules = await bodyOf<GithubBranchRule[]>({
    read: args.read,
    path: `/repos/${args.owner}/${args.repo}/rules/branches/${branch}`,
  })
  const fromRules = requiredContextsOf({ rules: rules ?? [], protection: null })
  if (fromRules.length > 0) return fromRules
  const protection = await bodyOf<GithubClassicRequiredChecks>({
    read: args.read,
    path: `/repos/${args.owner}/${args.repo}/branches/${branch}/protection/required_status_checks`,
  })
  const fromProtection = requiredContextsOf({ rules: [], protection })
  if (fromProtection.length > 0) return fromProtection
  return rules !== null && protection !== null ? [] : null
}

async function bodyOf<T>(args: {
  read: (path: string) => Promise<GithubPathRead>
  path: string
}): Promise<T | null> {
  try {
    const answer = await args.read(args.path)
    if (answer.status < 200 || answer.status >= 300) return null
    return answer.body as T
  } catch {
    return null
  }
}

export function requiredContextsKey(args: { owner: string; repo: string; branch: string }): string {
  return `${args.owner}/${args.repo}#${args.branch}`
}

export function recalledRequiredContexts(args: {
  cache: RequiredContextsCache
  key: string
  now: number
}): { acquiredAt: number; contexts: string[] } | undefined {
  const held = args.cache.get(args.key)
  if (held === undefined) return undefined
  return args.now - held.acquiredAt < REQUIRED_CHECKS_TTL_MS ? held : undefined
}

export function rememberRequiredContexts(args: {
  cache: RequiredContextsCache
  acquiredAt: number
  contexts: string[]
  key: string
}): string[] {
  args.cache.set(args.key, { acquiredAt: args.acquiredAt, contexts: args.contexts })

  return args.contexts
}
