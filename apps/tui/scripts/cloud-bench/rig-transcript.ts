import type { RigApp } from './rig-mount'

export type TranscriptBody = { type?: string; text?: string; parts?: unknown }

export type TranscriptEvent = { body?: TranscriptBody }

const READ_ATTEMPTS = 3
const RETRY_PAUSE_MS = 1_000
const REMOTE_REQUEST_LOST = 'RemoteRequestLost'
const USER_SAID = 'user-said'
const ASSISTANT_SAID = 'assistant-said'
const TEXT_PART = 'text'
const LINE_PREVIEW_CHARS = 160

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function bodyOf(event: unknown): TranscriptBody | null {
  if (!isRecord(event)) return null
  const carrier = isRecord(event.body) ? event.body : event
  if (typeof carrier.type !== 'string') return null
  return {
    type: carrier.type,
    ...(typeof carrier.text === 'string' ? { text: carrier.text } : {}),
    ...('parts' in carrier ? { parts: carrier.parts } : {}),
  }
}

export const isRemoteRequestLost = (error: unknown): boolean =>
  isRecord(error) && error.name === REMOTE_REQUEST_LOST

export async function readEventsRetrying(args: {
  read: () => Promise<readonly unknown[]>
  attempts?: number | undefined
  pauseMs?: number | undefined
}): Promise<readonly unknown[]> {
  const attempts = args.attempts ?? READ_ATTEMPTS
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await args.read()
    } catch (error) {
      if (!isRemoteRequestLost(error) || attempt >= attempts) throw error
      await Bun.sleep(args.pauseMs ?? RETRY_PAUSE_MS)
    }
  }
}

export async function transcriptOf(args: { rig: RigApp }): Promise<readonly TranscriptEvent[]> {
  const log = args.rig.cloudLog()
  if (log === null) throw new Error('the cloud transcript is not attached yet')
  const threadId = args.rig.threadId
  const events = await readEventsRetrying({ read: () => log.read({ threadId }) })
  return events.map((event) => {
    const body = bodyOf(event)
    return body === null ? {} : { body }
  })
}

export const assistantTextOf = (parts: unknown): string => {
  if (!Array.isArray(parts)) return ''
  return parts
    .filter(
      (part): part is { type: string; text: string } =>
        isRecord(part) && part.type === TEXT_PART && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('')
}

export function userSaidCount(args: { events: readonly unknown[]; text: string }): number {
  const wanted = args.text.trim()
  return args.events.filter((event) => {
    const body = bodyOf(event)
    return body?.type === USER_SAID && body.text?.trim() === wanted
  }).length
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function assistantSaid(args: {
  events: readonly unknown[]
  word: string
  afterIndex?: number | undefined
}): boolean {
  const pattern = new RegExp(`\\b${escapeRegExp(args.word)}\\b`, 'i')
  const from = args.afterIndex === undefined ? 0 : args.afterIndex + 1
  return args.events.slice(from).some((event) => {
    const body = bodyOf(event)
    return body?.type === ASSISTANT_SAID && pattern.test(assistantTextOf(body.parts))
  })
}

const previewOf = (body: TranscriptBody): string => {
  const text = body.type === ASSISTANT_SAID ? assistantTextOf(body.parts) : (body.text ?? '')
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LINE_PREVIEW_CHARS ? `${flat.slice(0, LINE_PREVIEW_CHARS)}…` : flat
}

export function transcriptLines(events: readonly unknown[]): string {
  if (events.length === 0) return '(no events)'
  return events
    .map((event, index) => {
      const body = bodyOf(event)
      if (body === null) return `${index}: (unrecognised event)`
      const preview = previewOf(body)
      return preview.length === 0 ? `${index}: ${body.type}` : `${index}: ${body.type}: ${preview}`
    })
    .join('\n')
}
