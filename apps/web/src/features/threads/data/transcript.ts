import { z } from 'zod'

import { BOOT_STEP_EVENT_TYPE, type WireEvent } from '@dltech/atlas-wire/web'

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

export const coreEventsOf = (events: readonly WireEvent[]): WireEvent[] =>
  events.filter((event) => event.type !== BOOT_STEP_EVENT_TYPE)

export function transcriptOf(events: readonly WireEvent[]): TranscriptItem[] {
  return coreEventsOf(events)
    .sort(bySeq)
    .flatMap((event) => {
      const said = textOf(event)
      if (said === null || said.text.trim().length === 0) return []
      return [{ kind: said.kind, id: event.id, text: said.text, at: event.at }]
    })
}

export const threadTitleOf = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LIMIT)
