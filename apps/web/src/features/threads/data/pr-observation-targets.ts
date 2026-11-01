import { GITHUB_REPO_PATTERN, type GithubPrStatesInput } from '@dltech/atlas-wire/web'

import { pullRequestKeyOf } from './pull-request-entries'

export type PrObservationTarget = NonNullable<NonNullable<GithubPrStatesInput>['observe']>[number]

export enum EPrObservationPriority {
  Inline = 'inline',
  Bulk = 'bulk',
}

export type PrObservation = PrObservationTarget & { priority?: EPrObservationPriority }

export const MAX_PR_OBSERVATIONS = 128

export function prObservationTargetsOf(
  targets: readonly PrObservationTarget[],
): PrObservationTarget[] {
  const byKey = new Map<string, PrObservationTarget>()
  for (const target of targets) {
    if (!Number.isSafeInteger(target.number) || target.number <= 0) continue
    const key = pullRequestKeyOf(target)
    const repo = key.slice(0, key.lastIndexOf('#'))
    if (!GITHUB_REPO_PATTERN.test(repo) || repo.length > 256) continue
    byKey.set(key, { repo, number: target.number })
  }
  return [...byKey.values()].sort((left, right) =>
    left.repo < right.repo ? -1 : left.repo > right.repo ? 1 : left.number - right.number,
  )
}

export const prObservationKeyOf = (targets: readonly PrObservationTarget[]): string =>
  JSON.stringify(prObservationTargetsOf(targets))

export function prObservationRegistrationsOf(observe: readonly PrObservation[]): PrObservation[] {
  const inline = new Set(
    prObservationTargetsOf(
      observe.filter((entry) => entry.priority === EPrObservationPriority.Inline),
    ).map(pullRequestKeyOf),
  )
  return prObservationTargetsOf(observe).map((target) =>
    inline.has(pullRequestKeyOf(target))
      ? { ...target, priority: EPrObservationPriority.Inline }
      : target,
  )
}

export const prObservationRegistrationKeyOf = (observe: readonly PrObservation[]): string =>
  JSON.stringify(prObservationRegistrationsOf(observe))

export function selectPrObservationTargets(
  observe: readonly PrObservation[],
): PrObservationTarget[] {
  const entries = prObservationRegistrationsOf(observe)
  const inline = entries.filter((entry) => entry.priority === EPrObservationPriority.Inline)
  const bulk = entries.filter((entry) => entry.priority !== EPrObservationPriority.Inline)
  return prObservationTargetsOf([...inline, ...bulk].slice(0, MAX_PR_OBSERVATIONS))
}

export function prObservationInputOf(observe: readonly PrObservation[] = []): GithubPrStatesInput {
  const targets = selectPrObservationTargets(observe)
  return targets.length === 0 ? undefined : { observe: targets }
}
