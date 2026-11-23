import type { CommandHandler, CommandResult } from '@dltech/atlas-commands'
import {
  latestRotationOf,
  transcriptOfRange,
  type Event,
  type EventDraft,
  type EventRef,
  type ModelPort,
  type PluginEventBody,
  type RecordBody,
} from '@dltech/atlas-core'

import { ROTATE_INSTRUCTION } from './prompt'
import { REFUSAL_ROTATE_CHILDREN, rotateArgs } from './spec'

export const REFUSAL_ROTATE_NOTHING = 'There is nothing to rotate: this thread has no messages yet.'
export const REFUSAL_ROTATE_NO_MODEL = 'This session has no model to rotate with.'
export const REFUSAL_ROTATE_EMPTY = 'The handoff came back empty.'
export const REFUSAL_ROTATE_FAILED = 'The handoff could not be written'
export const REFUSAL_ROTATE_UNCHANGED = 'This thread has nothing since the last rotation.'

export const ROTATE_TIMEOUT_MS = 120_000

const BOUNDARY_MARKERS: ReadonlySet<Event['type']> = new Set<Event['type']>([
  'rotated',
  'history-compacted',
])

const hasWorkSince = (args: { events: readonly Event[]; seq: number }): boolean =>
  args.events.some((event) => event.seq > args.seq && !BOUNDARY_MARKERS.has(event.type))

const handoffFrom = async ({
  model,
  origin,
  transcript,
  instructions,
}: {
  model: ModelPort
  origin: EventRef
  transcript: string
  instructions?: string | undefined
}): Promise<string> => {
  const content =
    instructions === undefined
      ? transcript
      : `Operator instruction for this rotation: ${instructions}\n\n${transcript}`
  const result = await model.step({
    assembled: {
      system: [{ text: ROTATE_INSTRUCTION }],
      messages: [{ message: { role: 'user', content: [{ type: 'text', text: content }] }, origin }],
    },
    tools: [],
    signal: AbortSignal.timeout(ROTATE_TIMEOUT_MS),
  })
  return result.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
}

export async function rotateNow(args: {
  model: ModelPort | undefined
  visibleEvents(): readonly Event[]
  append(drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]): Promise<void>
  instructions?: string | undefined
  auto?: { percent: number } | undefined
  log?: ((message: string) => void) | undefined
}): Promise<CommandResult> {
  const events = args.visibleEvents()
  if (!events.some((event) => event.type === 'user-said')) {
    return { kind: 'refused', reason: REFUSAL_ROTATE_NOTHING }
  }
  if (args.model === undefined) return { kind: 'refused', reason: REFUSAL_ROTATE_NO_MODEL }
  const boundary = latestRotationOf(events)
  const head = events[events.length - 1]
  if (head === undefined) return { kind: 'refused', reason: REFUSAL_ROTATE_NOTHING }
  if (boundary !== undefined && !hasWorkSince({ events, seq: boundary.seq })) {
    return { kind: 'refused', reason: REFUSAL_ROTATE_UNCHANGED }
  }
  const fromSeq = boundary === undefined ? 0 : boundary.seq + 1
  const transcript = transcriptOfRange({ events, fromSeq, throughSeq: head.seq })
  let handoff: string
  try {
    handoff = await handoffFrom({
      model: args.model,
      origin: { eventId: head.id, seq: head.seq },
      transcript,
      instructions: args.instructions,
    })
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message : String(failure)
    return { kind: 'refused', reason: `${REFUSAL_ROTATE_FAILED}: ${detail}` }
  }
  if (handoff.length === 0) return { kind: 'refused', reason: REFUSAL_ROTATE_EMPTY }
  await args.append([
    {
      type: 'rotated',
      handoff,
      ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
      ...(args.auto === undefined ? {} : { auto: args.auto }),
    },
  ])
  args.log?.(`rotated from seq ${fromSeq} through ${head.seq}`)
  return { kind: 'done' }
}

export const rotateHandler: CommandHandler<unknown> = async (context) => {
  if (context.runningChildren() > 0) {
    return { kind: 'refused', reason: REFUSAL_ROTATE_CHILDREN }
  }
  const parsed = rotateArgs.safeParse(context.args)
  if (!parsed.success) return { kind: 'refused', reason: parsed.error.message }
  return rotateNow({
    model: context.model,
    visibleEvents: context.visibleEvents,
    append: context.append,
    instructions: parsed.data.instructions,
    log: context.log,
  })
}
