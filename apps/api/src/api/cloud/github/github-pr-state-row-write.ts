import {
  announceSessionChangesIn,
  sessionsTrackingHeadIn,
  sessionsTrackingPullRequestIn,
} from '@dltech/atlas-control/postgres'
import type {
  EStoredChecksState,
  MergeabilitySample,
  PrFoldState,
  PullSample,
} from '@dltech/atlas-core'
import type { Row } from '@dltech/atlas-db'

import { normalizedRepo } from './github-pr-identity'
import type { PrScopeTx } from './github-pr-lock'

const instantDateOf = (iso: string | null): Date | null => (iso === null ? null : new Date(iso))

function mergeabilityOfState(state: PrFoldState): MergeabilitySample | null {
  const held = state.mergeability
  const pull = state.pull
  if (held === null || pull === null) return null

  return held.headSha === pull.headSha && held.baseBranch === pull.baseBranch ? held : null
}

function mergeabilityFieldsOf(mergeability: MergeabilitySample | null) {
  return {
    mergeable: mergeability?.mergeable ?? null,
    mergeClean: mergeability?.mergeClean ?? null,
    mergeableHeadSha: mergeability?.headSha ?? null,
    mergeableBaseRef: mergeability?.baseBranch ?? null,
    mergeableObservedAt: mergeability === null ? null : new Date(mergeability.observedAt),
  }
}

function pullFieldsOf(pull: PullSample) {
  return {
    title: pull.title,
    url: pull.url,
    state: pull.state,
    headBranch: pull.headBranch,
    headSha: pull.headSha,
    headRepoFullName: pull.headRepoFullName === null ? null : normalizedRepo(pull.headRepoFullName),
    baseBranch: pull.baseBranch,
    pullUpdatedAt: instantDateOf(pull.pullUpdatedAt),
    closedAt: instantDateOf(pull.closedAt),
    mergedAt: instantDateOf(pull.mergedAt),
  }
}

export async function writePrProvenance(args: {
  tx: PrScopeTx
  repoFullName: string
  prNumber: number
  state: PrFoldState
}): Promise<Row<'GithubPrState'> | null> {
  const pull = args.state.pull
  if (pull === null) return null

  return await args.tx.orm.public.GithubPrState.where({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
  }).update({
    pullUpdatedAt: instantDateOf(pull.pullUpdatedAt),
    closedAt: instantDateOf(pull.closedAt),
    mergedAt: instantDateOf(pull.mergedAt),
    ...mergeabilityFieldsOf(mergeabilityOfState(args.state)),
  })
}

export async function writePrStateRow(args: {
  tx: PrScopeTx
  repoFullName: string
  prNumber: number
  state: PrFoldState
  checksState: EStoredChecksState | null
  stored: Row<'GithubPrState'> | null
}): Promise<Row<'GithubPrState'>> {
  const pull = args.state.pull
  if (pull === null) throw new Error('an applied fold always holds a pull')
  const checks = args.state.checks
  const fields = {
    ...pullFieldsOf(pull),
    ...mergeabilityFieldsOf(mergeabilityOfState(args.state)),
    checksRunning: checks?.running ?? 0,
    checksPassed: checks?.passed ?? 0,
    checksFailed: checks?.failed ?? 0,
    checksIgnored: checks?.ignored ?? 0,
    checksState: args.checksState,
    updatedAt: new Date(),
    version: (args.stored?.version ?? 0) + 1,
  }
  const row = await args.tx.orm.public.GithubPrState.upsert({
    conflictOn: { repoFullName: args.repoFullName, prNumber: args.prNumber },
    create: { repoFullName: args.repoFullName, prNumber: args.prNumber, ...fields },
    update: fields,
  })
  const tracked = [
    ...(row.headRepoFullName === null
      ? []
      : await sessionsTrackingHeadIn({
          tx: args.tx,
          headRepo: row.headRepoFullName,
          branch: row.headBranch,
        })),
    ...(await sessionsTrackingPullRequestIn({
      tx: args.tx,
      repo: row.repoFullName,
      number: row.prNumber,
    })),
  ]
  if (tracked.length > 0) {
    await announceSessionChangesIn({ tx: args.tx, sessionIds: [...new Set(tracked)] })
  }

  return row
}
