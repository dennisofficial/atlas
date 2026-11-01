import { db, or } from '@dltech/atlas-db'
import type { LinkedPullRequestDto } from './sessions.types'

const fullNameOf = (repo: string): string => repo.replace(/^github\.com\//i, '').toLowerCase()
const patternOf = (repo: string): string => repo.replace(/[\\%_]/g, '\\$&')

const keyOf = (args: { repo: string; number: number }): string =>
  `${fullNameOf(args.repo)}#${args.number}`

export async function withPullRequestStates(args: {
  groups: readonly (readonly LinkedPullRequestDto[])[]
  viewerId: string
}): Promise<LinkedPullRequestDto[][]> {
  const copies = () => args.groups.map((group) => [...group])
  if (args.groups.every((group) => group.length === 0)) return copies()
  const subscriptions = await db.orm.public.GithubSubscription.where({ userId: args.viewerId })
    .where((subscription) => subscription.liveUntil.gt(new Date()))
    .select('repoFullName', 'prNumber')
    .all()
  const permitted = new Set(
    subscriptions.flatMap((subscription) =>
      subscription.prNumber === null
        ? []
        : [keyOf({ repo: subscription.repoFullName, number: subscription.prNumber })],
    ),
  )
  const linked = args.groups.flat().filter((pr) => permitted.has(keyOf(pr)))
  if (linked.length === 0) return copies()

  const repos = [...new Set(linked.map((pr) => fullNameOf(pr.repo)))]
  const numbers = [...new Set(linked.map((pr) => pr.number))]
  const rows = await db.orm.public.GithubPrState.where((pr) =>
    or(...repos.map((repo) => pr.repoFullName.ilike(patternOf(repo)))),
  )
    .where((pr) => pr.prNumber.in(numbers))
    .orderBy((pr) => pr.updatedAt.asc())
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

  return args.groups.map((group) =>
    group.map((pr) => {
      if (!permitted.has(keyOf(pr))) return pr
      const metadata = metadataByKey.get(keyOf(pr))
      return metadata === undefined ? pr : { ...pr, ...metadata }
    }),
  )
}
