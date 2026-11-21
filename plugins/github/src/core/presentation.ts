import {
  ESubscriptionTone,
  neutralPresentationOf,
  type SubscriptionPresentation,
  type SubscriptionPresentationInput,
  type SubscriptionPresenters,
} from '@dltech/atlas-core'

import { eventCatalogOf } from './event-catalog'
import { GITHUB_RUN_PROVIDER, runTargetOf, type RunTarget } from './run-target'
import { GITHUB_PROVIDER, labelOf, targetOf } from './target'

const EVENT_LABEL: Readonly<Record<string, string>> = { ci: 'CI' }

const filterSummaryOf = (provider: string, events: readonly string[]): string => {
  const catalog = eventCatalogOf(provider)
  const names = [...new Set(events)]
  if (names.length === 0) return 'all events'
  return catalog
    .map((spec) => spec.name)
    .filter((name) => names.includes(name))
    .map((name) => EVENT_LABEL[name] ?? name)
    .join(' · ')
}

const runTitleOf = (target: RunTarget): string =>
  target.kind === 'run' ? `run ${target.runId}` : `${target.workflow}@${target.branch}`

export const presentPullRequest = (
  input: SubscriptionPresentationInput,
): SubscriptionPresentation => {
  const target = targetOf(input.target)
  if (target === null) return neutralPresentationOf(input)
  return {
    icon: 'git-pull-request',
    tone: ESubscriptionTone.Open,
    title: labelOf(target),
    meta: ['Pull request', filterSummaryOf(input.provider, input.events)],
  }
}

export const presentWorkflowRun = (
  input: SubscriptionPresentationInput,
): SubscriptionPresentation => {
  const target = runTargetOf(input.target)
  return {
    icon: 'circle-play',
    tone: ESubscriptionTone.Running,
    title: target === null ? input.label : runTitleOf(target),
    meta: ['Workflow run'],
  }
}

export const githubPresenters: SubscriptionPresenters = {
  [GITHUB_PROVIDER]: presentPullRequest,
  [GITHUB_RUN_PROVIDER]: presentWorkflowRun,
}
