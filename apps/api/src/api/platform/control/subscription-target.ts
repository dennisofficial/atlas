import type { JsonValue } from '@dltech/atlas-core'
import {
  GITHUB_PROVIDER,
  GITHUB_RUN_PROVIDER,
  NO_PULL_REQUEST_ERROR,
  NO_REPOSITORY_ERROR,
  NO_RUN_REPOSITORY_ERROR,
  UNRECOGNIZED_ERROR,
  UNRECOGNIZED_RUN_ERROR,
  labelOf,
  parseRunTargetInput,
  parseTargetInput,
  runLabelOf,
  runSelectorOf,
} from '@dltech/atlas-plugin-github/core'

export type ResolvedSubscriptionTarget = {
  target: JsonValue
  label: string
  lease: {
    repo: string
    subject: { kind: 'pull-request'; number: number } | { kind: 'workflow-run'; selector: string }
  }
}

export class SubscriptionTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubscriptionTargetError'
  }
}

const pullRequestTargetOf = (raw: string): ResolvedSubscriptionTarget => {
  const parsed = parseTargetInput(raw)
  if (parsed.kind === 'error') throw new SubscriptionTargetError(parsed.error)
  if (parsed.kind === 'current') throw new SubscriptionTargetError(NO_PULL_REQUEST_ERROR)
  if (parsed.kind === 'number') throw new SubscriptionTargetError(NO_REPOSITORY_ERROR)
  return {
    target: parsed.target,
    label: labelOf(parsed.target),
    lease: {
      repo: parsed.target.repo,
      subject: { kind: 'pull-request', number: parsed.target.number },
    },
  }
}

const runTargetOf = (raw: string): ResolvedSubscriptionTarget => {
  const parsed = parseRunTargetInput(raw)
  if (parsed.kind === 'error') throw new SubscriptionTargetError(parsed.error)
  if (parsed.kind === 'current') throw new SubscriptionTargetError(NO_RUN_REPOSITORY_ERROR)
  if (parsed.kind === 'selector') throw new SubscriptionTargetError(UNRECOGNIZED_RUN_ERROR)
  if (parsed.repo === undefined) throw new SubscriptionTargetError(NO_RUN_REPOSITORY_ERROR)
  const target = { kind: 'run' as const, repo: parsed.repo, runId: parsed.runId }
  return {
    target,
    label: runLabelOf(target),
    lease: {
      repo: target.repo,
      subject: { kind: 'workflow-run', selector: runSelectorOf(target) },
    },
  }
}

export const resolvedSubscriptionTargetOf = (args: {
  provider: string
  target: string
}): ResolvedSubscriptionTarget => {
  if (args.provider === GITHUB_PROVIDER) return pullRequestTargetOf(args.target)
  if (args.provider === GITHUB_RUN_PROVIDER) return runTargetOf(args.target)
  throw new SubscriptionTargetError(UNRECOGNIZED_ERROR)
}
