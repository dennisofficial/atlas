import { db } from '@dltech/atlas-db'
import type { LinkedPullRequestDto } from './sessions.types'

const fullNameOf = (repo: string): string => repo.replace(/^github\.com\//i, '').toLowerCase()

const keyOf = (args: { repo: string; number: number }): string =>
  `${fullNameOf(args.repo)}#${args.number}`

export async function withPullRequestStates(
  groups: readonly (readonly LinkedPullRequestDto[])[],
): Promise<LinkedPullRequestDto[][]> {
  const linked = groups.flat()
  if (linked.length === 0) return groups.map((group) => [...group])

  const repos = [...new Set(linked.map((pr) => fullNameOf(pr.repo)))]
  const numbers = [...new Set(linked.map((pr) => pr.number))]
  const rows = await db.orm.public.GithubPrState.where((pr) => pr.repoFullName.in(repos))
    .where((pr) => pr.prNumber.in(numbers))
    .select(
      'repoFullName',
      'prNumber',
      'state',
      'title',
      'checksRunning',
      'checksPassed',
      'checksFailed',
      'mergeable',
    )
    .all()
  const metadataByKey = new Map(
    rows.map(({ repoFullName, prNumber, ...metadata }) => [
      keyOf({ repo: repoFullName, number: prNumber }),
      metadata,
    ]),
  )

  return groups.map((group) =>
    group.map((pr) => {
      const metadata = metadataByKey.get(keyOf(pr))
      return metadata === undefined ? pr : { ...pr, ...metadata }
    }),
  )
}
