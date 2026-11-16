import { EArtifactBuildOutcome, type EventDraft, type Subscription } from '@dltech/atlas-core'
import { artifactSubdomainSchema, type ArtifactBuildOutcome } from '@dltech/atlas-wire'

import {
  EOccurrenceUrgency,
  type SubscriptionOccurrence,
  type SubscriptionProvider,
} from '../subscriptions/provider'

import { ArtifactNotFound, type ArtifactPort } from './artifact-port'

export const ARTIFACT_BUILD_PROVIDER_KIND = 'artifact.build'

export const ARTIFACT_BUILD_TICK_MS = 5_000

const LOG_TAIL_CHARS = 4_000

const VERSION = /^[1-9][0-9]*$/

const GONE_FAILURE = 'the artifact no longer exists'

export type ArtifactBuildTarget = { subdomain: string; version: number }

const targetOf = (target: unknown): ArtifactBuildTarget | null => {
  if (typeof target !== 'object' || target === null) return null
  const { subdomain, version } = target as { subdomain?: unknown; version?: unknown }
  if (typeof subdomain !== 'string' || !artifactSubdomainSchema.safeParse(subdomain).success) {
    return null
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) return null
  return { subdomain, version }
}

const parsedTarget = (input: string): ArtifactBuildTarget | null => {
  const at = input.lastIndexOf('@')
  if (at <= 0) return null
  const subdomain = input.slice(0, at)
  const versionText = input.slice(at + 1)
  if (!VERSION.test(versionText)) return null
  return targetOf({ subdomain, version: Number(versionText) })
}

const outcomeOf = (outcome: ArtifactBuildOutcome): EArtifactBuildOutcome | null => {
  if (outcome === EArtifactBuildOutcome.Ready) return EArtifactBuildOutcome.Ready
  if (outcome === EArtifactBuildOutcome.Failed) return EArtifactBuildOutcome.Failed
  if (outcome === EArtifactBuildOutcome.Superseded) return EArtifactBuildOutcome.Superseded
  return null
}

const tailOf = (log: string | null): string | undefined =>
  log === null || log.length === 0 ? undefined : log.slice(-LOG_TAIL_CHARS)

type Emit = (occurrence: SubscriptionOccurrence) => void

type Watch = {
  subscription: Subscription
  target: ArtifactBuildTarget
  emit: Emit
  timer: ReturnType<typeof setInterval> | null
  reading: boolean
  stopped: boolean
}

type SettledStatus = {
  url?: string | undefined
  failure?: string | undefined
  log?: string | undefined
  durationMs: number | null
  supersededBy: number | null
}

const occurrenceOf = (args: {
  target: ArtifactBuildTarget
  status: SettledStatus
  outcome: EArtifactBuildOutcome
}): SubscriptionOccurrence => {
  const { target, status, outcome } = args
  const eventId = `artifact-build:${target.subdomain}:${target.version}:${outcome}`
  const draft: EventDraft = {
    type: 'artifact-build-event',
    subdomain: target.subdomain,
    version: target.version,
    outcome,
    eventId,
    ...(status.url === undefined ? {} : { url: status.url }),
    ...(status.failure === undefined ? {} : { failure: status.failure }),
    ...(status.log === undefined ? {} : { log: status.log }),
    ...(status.durationMs === null ? {} : { durationMs: status.durationMs }),
    ...(status.supersededBy === null ? {} : { supersededBy: status.supersededBy }),
  }

  return { key: eventId, urgency: EOccurrenceUrgency.Now, ends: true, draft }
}

export function createArtifactBuildProvider(args: {
  port: ArtifactPort
  tickMs?: number
}): SubscriptionProvider {
  const tickMs = args.tickMs ?? ARTIFACT_BUILD_TICK_MS

  const stop = (watch: Watch): void => {
    watch.stopped = true
    if (watch.timer !== null) clearInterval(watch.timer)
    watch.timer = null
  }

  const readOccurrence = async (watch: Watch): Promise<SubscriptionOccurrence | null> => {
    const { target } = watch
    try {
      const status = await args.port.buildStatus({
        subdomain: target.subdomain,
        version: target.version,
      })
      const outcome = outcomeOf(status.outcome)
      if (outcome === null) return null
      return occurrenceOf({
        target,
        status: {
          url: status.url,
          failure: status.failure === null ? undefined : status.failure,
          log: tailOf(status.log),
          durationMs: status.durationMs,
          supersededBy: status.supersededBy,
        },
        outcome,
      })
    } catch (error) {
      if (!(error instanceof ArtifactNotFound)) return null
      return occurrenceOf({
        target,
        status: { failure: GONE_FAILURE, durationMs: null, supersededBy: null },
        outcome: EArtifactBuildOutcome.Failed,
      })
    }
  }

  const poll = async (watch: Watch): Promise<void> => {
    if (watch.stopped || watch.reading) return

    watch.reading = true
    try {
      const occurrence = await readOccurrence(watch)
      if (occurrence === null || watch.stopped) return

      watch.emit(occurrence)
      stop(watch)
    } finally {
      watch.reading = false
    }
  }

  const start = (args: { subscription: Subscription; emit: Emit }): (() => void) => {
    const target = targetOf(args.subscription.target)
    if (target === null) return () => undefined

    const watch: Watch = {
      subscription: args.subscription,
      target,
      emit: args.emit,
      timer: null,
      reading: false,
      stopped: false,
    }

    void poll(watch)
    const timer = setInterval(() => void poll(watch), tickMs)
    timer.unref?.()
    watch.timer = timer

    return () => stop(watch)
  }

  return {
    kind: ARTIFACT_BUILD_PROVIDER_KIND,
    summary: 'Artifact build results: the build of one pushed version finishing.',
    targetHint: '<subdomain>@<version>, as artifact_push reports them.',
    resolve: async ({ input }) => {
      const target = parsedTarget(input.trim())
      if (target === null) {
        return { error: `artifact.build takes <subdomain>@<version>, and ${input} is not one.` }
      }

      return {
        target,
        label: `artifact ${target.subdomain} v${target.version} build`,
      }
    },
    start,
  }
}
