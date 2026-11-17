import { db, type Tx } from '@dltech/atlas-db'
import { SUITE_KEY_PREFIX } from './github-check-suites'
import { normalizedRepo } from './github-pr-identity'

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

export type RequiredContextsCache = Map<string, { at: number; contexts: string[] }>

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
 * A lookup that fails answers "no required checks known", which keeps the head's settlement
 * exactly as it was before required checks were consulted: a permission problem or an outage
 * must never leave verdicts unsettled forever.
 */
export async function requiredContextsFrom(args: {
  read: (path: string) => Promise<GithubPathRead>
  owner: string
  repo: string
  branch: string
}): Promise<string[]> {
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
  return requiredContextsOf({ rules: rules ?? [], protection })
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
}): string[] | undefined {
  const held = args.cache.get(args.key)
  if (held === undefined) return undefined
  return args.now - held.at < REQUIRED_CHECKS_TTL_MS ? held.contexts : undefined
}

export function rememberRequiredContexts(args: {
  cache: RequiredContextsCache
  key: string
  now: number
  contexts: string[]
}): string[] {
  args.cache.set(args.key, { at: args.now, contexts: args.contexts })
  return args.contexts
}

export function missingOf(args: {
  requiredContexts: readonly string[]
  present: ReadonlySet<string>
}): string[] {
  return args.requiredContexts.filter((context) => !args.present.has(context))
}

/**
 * A required context GitHub has not reported on this head yet is a check that has not run: the
 * head is not settled, so no verdict may close CI. A repo with no required contexts, or one whose
 * lookup failed, yields nothing here and settles on its observed tally alone.
 */
export async function missingRequiredContexts(args: {
  tx?: Tx
  repoFullName: string
  headSha: string
  requiredContexts: readonly string[]
}): Promise<string[]> {
  if (args.requiredContexts.length === 0) return []
  const orm = args.tx === undefined ? db.orm : args.tx.orm
  const rows = await orm.public.GithubCommitCheck.select('checkKey', 'name')
    .where({
      repoFullName: normalizedRepo(args.repoFullName),
      headSha: args.headSha,
    })
    .all()
  const present = new Set(
    rows.flatMap((row) =>
      row.checkKey.startsWith(SUITE_KEY_PREFIX) || row.name === null ? [] : [row.name],
    ),
  )
  return missingOf({ requiredContexts: args.requiredContexts, present })
}
