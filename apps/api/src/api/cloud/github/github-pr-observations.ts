import {
  EPrSource,
  pullSampleOfPayload,
  pullStateOfSample,
  type PrObservation,
  type PullSample,
} from '@dltech/atlas-core'

import type { RestPullRequest } from './github-pull-request-mapping'

const sampleIsComplete = (sample: PullSample): boolean =>
  [sample.repoFullName, sample.url, sample.headBranch, sample.headSha, sample.baseBranch].every(
    (field) => typeof field === 'string' && field !== '',
  ) &&
  Number.isInteger(sample.prNumber) &&
  typeof sample.pullUpdatedAt === 'string' &&
  !Number.isNaN(Date.parse(sample.pullUpdatedAt))

export function pullObservationOfWebhook(args: {
  payload: unknown
  observedAt: string
}): PrObservation | null {
  const sample = pullSampleOfPayload(args.payload)
  if (sample === null || !sampleIsComplete(sample)) return null

  return {
    kind: 'pull',
    source: EPrSource.WebhookPull,
    observedAt: args.observedAt,
    sample,
  }
}

export function pullSampleOfRest(args: {
  repoFullName: string
  pull: RestPullRequest
  updatedAt: string
}): PullSample {
  const pull = args.pull
  const state = pullStateOfSample({
    state: pull.state,
    draft: pull.draft,
    mergedAt: pull.merged_at,
  })

  return {
    repoFullName: args.repoFullName,
    prNumber: pull.number,
    title: pull.title ?? '',
    url: pull.html_url ?? '',
    state,
    headBranch: pull.head?.ref ?? '',
    headSha: pull.head?.sha ?? '',
    headRepoFullName: pull.head?.repo?.full_name ?? null,
    baseBranch: pull.base?.ref ?? '',
    pullUpdatedAt: args.updatedAt,
    closedAt: null,
    mergedAt: pull.merged_at ?? null,
  }
}

export function pullObservationOfRest(args: {
  repoFullName: string
  pull: RestPullRequest
  updatedAt: string
  observedAt: string
  source: EPrSource
}): PrObservation | null {
  if (typeof args.updatedAt !== 'string' || Number.isNaN(Date.parse(args.updatedAt))) return null
  const sample = pullSampleOfRest(args)
  if (!sampleIsComplete(sample)) return null

  return {
    kind: 'pull',
    source: args.source,
    observedAt: args.observedAt,
    sample,
  }
}

export function mergeabilitySampleOfRest(args: { pull: RestPullRequest; observedAt: string }) {
  return {
    headSha: args.pull.head.sha,
    baseBranch: args.pull.base.ref,
    mergeable: args.pull.mergeable,
    mergeClean: args.pull.mergeable === null ? null : args.pull.mergeable_state === 'clean',
    observedAt: args.observedAt,
  }
}

export function mergeabilityObservationOf(args: {
  pull: RestPullRequest
  observedAt: string
  source: EPrSource
}): PrObservation {
  return {
    kind: 'mergeability',
    source: args.source,
    observedAt: args.observedAt,
    sample: mergeabilitySampleOfRest(args),
  }
}
