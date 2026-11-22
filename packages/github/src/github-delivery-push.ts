import { db, or } from '@dltech/atlas-db'

import { GithubPrOutboxWriter, type PrOutboxEffect } from './github-pr-outbox'
import { repoPattern } from './github-pr-identity'

const HEADS_REF_PREFIX = 'refs/heads/'

export function baseBranchOfPush(ref: string): string {
  return ref.startsWith(HEADS_REF_PREFIX) ? ref.slice(HEADS_REF_PREFIX.length) : ''
}

export function refreshAfterBasePush(args: {
  repoFullName: string
  ref: string
  after: string | undefined
}): Promise<readonly string[]> {
  const baseBranch = baseBranchOfPush(args.ref)
  if (baseBranch === '' || args.after === undefined || args.after === '') return Promise.resolve([])

  return db.transaction(async (tx) => {
    const prs = await tx.orm.public.GithubPrState.where((pr) =>
      pr.repoFullName.ilike(repoPattern(args.repoFullName)),
    )
      .where((pr) => pr.baseBranch.eq(baseBranch))
      .where((pr) => or(pr.state.eq('open'), pr.state.eq('draft')))
      .all()
    const ids: string[] = []
    for (const pr of prs) {
      ids.push(
        ...(await GithubPrOutboxWriter.write({
          tx,
          repoFullName: args.repoFullName,
          prNumber: pr.prNumber,
          effects: [mergeabilityRefreshEffectOf({ ...args, prNumber: pr.prNumber })],
        })),
      )
    }

    return ids
  })
}

function mergeabilityRefreshEffectOf(args: {
  repoFullName: string
  after: string | undefined
  prNumber: number
}): PrOutboxEffect {
  return {
    kind: 'mergeability-refresh',
    payload: { repoFullName: args.repoFullName, prNumber: args.prNumber },
    dedupeKey: `mergeability-refresh:${args.repoFullName}#${args.prNumber}:${args.after ?? ''}`,
  }
}
