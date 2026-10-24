import { db } from '@dltech/atlas-db'
import type { LinkedPullRequestDto } from './sessions.types'

const keyOf = (args: { repo: string; number: number }): string => `${args.repo}#${args.number}`

export async function withPullRequestStates(
  groups: readonly (readonly LinkedPullRequestDto[])[],
): Promise<LinkedPullRequestDto[][]> {
  const linked = groups.flat()
  if (linked.length === 0) return groups.map((group) => [...group])

  const repos = [...new Set(linked.map((pr) => pr.repo))]
  const numbers = [...new Set(linked.map((pr) => pr.number))]
  const rows = await db.orm.public.GithubPrState.where((pr) => pr.repoFullName.in(repos))
    .where((pr) => pr.prNumber.in(numbers))
    .select('repoFullName', 'prNumber', 'state')
    .all()
  const stateByKey = new Map(
    rows.map((row) => [keyOf({ repo: row.repoFullName, number: row.prNumber }), row.state]),
  )

  return groups.map((group) =>
    group.map((pr) => {
      const state = stateByKey.get(keyOf(pr))
      return state === undefined ? pr : { ...pr, state }
    }),
  )
}
