import { EBlockKind, type CallId, type Event } from '@dltech/atlas-core'
import { EStepEnd, type StepSignal } from '../channel'

import { durableEntries } from './durable-entries'
import {
  liveSteps,
  runKey,
  stepsOfSignalsAt,
  type Clock,
  type InFlightStep,
} from './in-flight-steps'
import { sandboxNoticeOf, type TranscriptSandbox } from './sandbox-notice'
import { persistedFailureOf } from './persisted-failure'
import { revealedText, type RevealGate } from './reveal-gate'
import { modelEntries } from './model-entries'
import { liveToolRuns, type LiveToolRun } from './tool-runs'
import {
  foldThoughts,
  SHIPPED_THINKING,
  toolsAboveThoughts,
  type EThinkingVisibility,
} from './thinking-fold'
import { EAuthor, EEntryKind, toolsRanEntry, type TranscriptEntry } from './transcript-model'
import { EMPTY_TRANSCRIPT, type StepFailure, type TranscriptModel } from './transcript-snapshot'
import type { TurnSpend } from './turn-spend'

const failureOf = (steps: readonly InFlightStep[]): StepFailure | null => {
  const failed = steps.filter((step) => step.end === EStepEnd.Failed).at(-1)
  return failed === undefined ? null : { message: failed.errorMessage }
}

function saidInStep(args: { step: InFlightStep; reveal: RevealGate | null }): TranscriptEntry[] {
  return modelEntries({
    runs: args.step.blocks.map((block) => {
      const key = runKey({
        stepId: args.step.stepId,
        kind: block.kind,
        id: block.id,
      })
      return {
        key,
        text: revealedText({ key, text: block.text, gate: args.reveal }),
        isReasoning: block.kind === EBlockKind.Reasoning,
      }
    }),
    streaming: args.step.end === null,
    interruptedAtEnd: args.step.end === EStepEnd.Interrupted,
  })
}

function interleaved(args: {
  said: readonly TranscriptEntry[]
  runs: readonly LiveToolRun[]
}): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  let cursor = 0

  for (const { run, precededByBlocks } of args.runs) {
    const upTo = Math.max(cursor, Math.min(precededByBlocks, args.said.length))
    entries.push(...args.said.slice(cursor, upTo), toolsRanEntry(run))
    cursor = upTo
  }

  entries.push(...args.said.slice(cursor))
  return entries
}

function entriesOfStep(args: { step: InFlightStep; reveal: RevealGate | null }): TranscriptEntry[] {
  return interleaved({
    said: saidInStep(args),
    runs: liveToolRuns(args.step.calls),
  })
}

/**
 * What a running call has printed so far, attached where the transcript can read it.
 *
 * Live output arrives on its own signal, keyed by call rather than by step — a tool runs BETWEEN
 * steps, so the step tracker has no home for it. Both sides of the transcript carry the call it
 * belongs to: a call still being dictated is a live run, and one dispatched and executing is a
 * durable run, so the attachment reads every ToolsRan entry rather than picking a side.
 */
function withLiveOutputs(
  entries: readonly TranscriptEntry[],
  outputs: ReadonlyMap<CallId, string>,
): readonly TranscriptEntry[] {
  if (outputs.size === 0) return entries

  return entries.map((entry) => {
    if (entry.kind !== EEntryKind.ToolsRan) return entry
    if (!entry.run.calls.some((call) => outputs.has(call.callId))) return entry

    return {
      ...entry,
      run: {
        ...entry.run,
        calls: entry.run.calls.map((call) => {
          const liveOutput = outputs.get(call.callId)
          return liveOutput === undefined || call.liveOutput === liveOutput
            ? call
            : { ...call, liveOutput }
        }),
      },
    }
  })
}

const NO_OUTPUTS: ReadonlyMap<CallId, string> = new Map()

export function assembleTranscript(args: {
  durable: readonly TranscriptEntry[]
  live: readonly InFlightStep[]
  reveal?: RevealGate | null
  thinking?: EThinkingVisibility
  pendingTldr?: { anchorSeq: number; text: string } | null | undefined
  tldrStatus?: boolean | undefined
  sandbox?: TranscriptSandbox | null | undefined
  outputs?: ReadonlyMap<CallId, string> | undefined
  working?: boolean | undefined
  persistedFailure?: StepFailure | null | undefined
}): TranscriptModel {
  const reveal = args.reveal ?? null
  const pending = args.pendingTldr ?? null
  const entries = [
    ...foldThoughts({
      entries: withTldrStatus({
        entries: withPendingTldr({
          entries: withLiveOutputs(
            toolsAboveThoughts([
              ...args.durable,
              ...args.live.flatMap((step) => entriesOfStep({ step, reveal })),
            ]),
            args.outputs ?? NO_OUTPUTS,
          ),
          pending,
        }),
        enabled: args.tldrStatus ?? true,
      }),
      visibility: args.thinking ?? SHIPPED_THINKING,
    }),
    ...sandboxNoticeOf(args.sandbox ?? null),
  ]
  const streaming = args.live.some((step) => step.end === null) || args.working === true
  const failure = failureOf(args.live) ?? (streaming ? null : (args.persistedFailure ?? null))

  if (entries.length === 0 && !streaming && failure === null) {
    return EMPTY_TRANSCRIPT
  }

  return { entries, isEmpty: entries.length === 0, streaming, failure }
}

export function deriveTranscript(args: {
  events: readonly Event[]
  signals: readonly StepSignal[]
  turns?: readonly TurnSpend[] | undefined
  reveal?: RevealGate | null
  thinking?: EThinkingVisibility
  pendingTldr?: { anchorSeq: number; text: string } | null | undefined
  tldrStatus?: boolean | undefined
  sandbox?: TranscriptSandbox | null | undefined
  outputs?: ReadonlyMap<CallId, string> | undefined
  now?: Clock | undefined
}): TranscriptModel {
  return assembleTranscript({
    durable: durableEntries({ events: args.events, turns: args.turns }),
    persistedFailure: persistedFailureOf(args.events),
    live: liveSteps({
      steps: stepsOfSignalsAt({ signals: args.signals, now: args.now }),
      events: args.events,
    }),
    ...(args.reveal === undefined ? {} : { reveal: args.reveal }),
    ...(args.thinking === undefined ? {} : { thinking: args.thinking }),
    ...(args.pendingTldr === undefined ? {} : { pendingTldr: args.pendingTldr }),
    ...(args.tldrStatus === undefined ? {} : { tldrStatus: args.tldrStatus }),
    ...(args.sandbox === undefined ? {} : { sandbox: args.sandbox }),
    ...(args.outputs === undefined ? {} : { outputs: args.outputs }),
  })
}

function withTldrStatus(args: {
  entries: readonly TranscriptEntry[]
  enabled: boolean
}): TranscriptEntry[] {
  if (args.enabled) return [...args.entries]

  return args.entries.map((entry) =>
    entry.kind === EEntryKind.TldrWritten && entry.status !== undefined
      ? { ...entry, status: undefined }
      : entry,
  )
}

const PENDING_TLDR_KEY = 'tldr-pending'

function withPendingTldr(args: {
  entries: readonly TranscriptEntry[]
  pending: { anchorSeq: number; text: string } | null
}): TranscriptEntry[] {
  const { pending } = args
  if (pending === null) return [...args.entries]

  const entries = args.entries.filter(
    (entry) => !(entry.kind === EEntryKind.TldrWritten && entry.anchorSeq === pending.anchorSeq),
  )
  const footer: TranscriptEntry = {
    kind: EEntryKind.TldrWritten,
    author: EAuthor.Model,
    key: PENDING_TLDR_KEY,
    text: pending.text,
    anchorSeq: pending.anchorSeq,
    throughSeq: 0,
    streaming: true,
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]?.kind === EEntryKind.TurnEnded) {
      return [...entries.slice(0, index), footer, ...entries.slice(index)]
    }
  }
  return [...entries, footer]
}
