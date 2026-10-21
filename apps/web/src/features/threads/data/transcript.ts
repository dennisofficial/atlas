import { z } from 'zod'

import {
  BOOT_STEP_ORDER,
  EBootStep,
  EBootStepState,
  bootStepOfWire,
  foldBootSteps,
  type BootStepEvent,
  type WireEvent,
} from '@dltech/atlas-wire/web'

import type { PendingSend } from './pending-sends'

const USER_SAID = 'user-said'
const ASSISTANT_SAID = 'assistant-said'
const TITLE_LIMIT = 60

export enum ETranscriptKind {
  User = 'user',
  Agent = 'agent',
}

export type TranscriptItem = { kind: ETranscriptKind; id: string; text: string; at: string }

const userBodySchema = z.object({ text: z.string() })
const assistantBodySchema = z.object({
  parts: z.array(z.object({ type: z.string(), text: z.string().optional() })),
})

function parseBody<TSchema extends z.ZodType>(args: {
  schema: TSchema
  body: string
}): z.infer<TSchema> | null {
  try {
    const parsed = args.schema.safeParse(JSON.parse(args.body))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const bySeq = (left: WireEvent, right: WireEvent): number => left.seq - right.seq

function textOf(event: WireEvent): { kind: ETranscriptKind; text: string } | null {
  if (event.type === USER_SAID) {
    const body = parseBody({ schema: userBodySchema, body: event.body })
    return body === null ? null : { kind: ETranscriptKind.User, text: body.text }
  }
  if (event.type === ASSISTANT_SAID) {
    const body = parseBody({ schema: assistantBodySchema, body: event.body })
    if (body === null) return null
    const text = body.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    return { kind: ETranscriptKind.Agent, text }
  }
  return null
}

export function transcriptOf(events: readonly WireEvent[]): TranscriptItem[] {
  return [...events].sort(bySeq).flatMap((event) => {
    const said = textOf(event)
    if (said === null || said.text.trim().length === 0) return []
    return [{ kind: said.kind, id: event.id, text: said.text, at: event.at }]
  })
}

export function isSendDelivered(args: {
  items: readonly TranscriptItem[]
  pending: PendingSend
}): boolean {
  const text = args.pending.text.trim()
  return args.items.some((item) => item.kind === ETranscriptKind.User && item.text.trim() === text)
}

export function withPendingSend(args: {
  items: TranscriptItem[]
  pending: PendingSend | undefined
}): TranscriptItem[] {
  const { items, pending } = args
  if (pending === undefined || isSendDelivered({ items, pending })) return items
  return [
    ...items,
    { kind: ETranscriptKind.User, id: `pending-${pending.sendId}`, text: pending.text, at: '' },
  ]
}

export const threadTitleOf = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT)

const BOOT_LABELS: Record<EBootStep, string> = {
  [EBootStep.Provision]: 'Create sandbox',
  [EBootStep.Serve]: 'Start Atlas',
  [EBootStep.Clone]: 'Clone repository',
  [EBootStep.Context]: 'Load skills and instructions',
  [EBootStep.Settings]: 'Apply settings',
  [EBootStep.Agent]: 'Start agent',
}

export type BootStepView = {
  id: EBootStep
  label: string
  state: EBootStepState
  detail?: string
}

export type BootView = {
  steps: BootStepView[]
  state: EBootStepState
  error?: string
  elapsedMs?: number
}

type StampedBootEvent = { event: BootStepEvent; at: number }

function overallStateOf(steps: readonly BootStepView[]): EBootStepState {
  if (steps.some((step) => step.state === EBootStepState.Error)) return EBootStepState.Error
  if (steps.every((step) => step.state === EBootStepState.Done)) return EBootStepState.Done
  if (steps.some((step) => step.state !== EBootStepState.Pending)) return EBootStepState.Running
  return EBootStepState.Pending
}

function elapsedOf(args: {
  state: EBootStepState
  attempt: readonly StampedBootEvent[]
  now: number
}): number | undefined {
  const first = args.attempt[0]
  const last = args.attempt.at(-1)
  if (first === undefined || last === undefined) return undefined
  if (args.state === EBootStepState.Done) return Math.max(0, last.at - first.at)
  if (args.state === EBootStepState.Running) return Math.max(0, args.now - first.at)
  return undefined
}

export function bootViewOf(args: { events: readonly WireEvent[]; now: number }): BootView | null {
  const stamped = [...args.events].sort(bySeq).flatMap((wire) => {
    const event = bootStepOfWire(wire)
    return event === null ? [] : [{ event, at: Date.parse(wire.at) }]
  })
  if (stamped.length === 0) return null
  const lastStart = stamped.findLastIndex(
    ({ event }) => event.step === EBootStep.Provision && event.state === EBootStepState.Running,
  )
  const attempt = stamped.slice(Math.max(lastStart, 0))
  const folded = foldBootSteps(attempt.map(({ event }) => event))
  const steps = BOOT_STEP_ORDER.map((id): BootStepView => {
    const status = folded[id]
    const detail = status.state === EBootStepState.Error ? (status.error ?? status.detail) : status.detail
    return {
      id,
      label: BOOT_LABELS[id],
      state: status.state,
      ...(detail === undefined ? {} : { detail }),
    }
  })
  const state = overallStateOf(steps)
  const error = steps.find((step) => step.state === EBootStepState.Error)?.detail
  const elapsedMs = elapsedOf({ state, attempt, now: args.now })
  return {
    steps,
    state,
    ...(error === undefined ? {} : { error }),
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
  }
}
