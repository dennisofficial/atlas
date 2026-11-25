import type { InboxEntry, SpawnFile, RecordEvent } from '@dltech/atlas-core'
import { INBOX_KIND_MESSAGE, inboxMessageSchema } from '@dltech/atlas-protocol'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HeldSessionDeps } from './held-session-deps'
import type { ContextFilePlacement } from './place-context-files'
import type { PrepareResult, SessionRuntime } from './ports'
import type { SessionRecord } from './record/record-adapter'

export type ContextSeedOutcome = { ok: true } | { ok: false; reason: string }

const isPostedMessage = (
  event: RecordEvent,
): event is Extract<RecordEvent, { type: 'input-posted' }> =>
  event.type === 'input-posted' && event.kind === INBOX_KIND_MESSAGE

const firstPostedMessageOf = (events: readonly RecordEvent[]): number | undefined =>
  events.find(isPostedMessage)?.inboxId

const payloadOf = (entry: InboxEntry): unknown => {
  try {
    return JSON.parse(entry.payload)
  } catch {
    return undefined
  }
}

const filesOf = (entry: InboxEntry | undefined): readonly SpawnFile[] => {
  if (entry === undefined) return []
  const parsed = inboxMessageSchema.safeParse(payloadOf(entry))
  if (!parsed.success) return []
  return (parsed.data.files ?? []).map((file) => ({ path: file.path, text: file.text }))
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const failureOf = (args: { placed: ContextFilePlacement; error: unknown }): ContextSeedOutcome => {
  if (args.error !== undefined) {
    return {
      ok: false,
      reason: `could not place the attached context files: ${messageOf(args.error)}`,
    }
  }
  if (args.placed.refused.length > 0) {
    return {
      ok: false,
      reason: `could not place the attached context files: ${args.placed.refused.join('; ')}`,
    }
  }
  return { ok: true }
}

const placeFiles = async (args: {
  runtime: SessionRuntime
  files: readonly SpawnFile[]
}): Promise<ContextSeedOutcome> => {
  const place = args.runtime.placeContextFiles
  if (place === undefined) return { ok: true }
  let placed: ContextFilePlacement = { written: 0, refused: [] }
  let error: unknown
  try {
    placed = await place({ files: args.files })
  } catch (thrown) {
    error = thrown
  }
  return failureOf({ placed, error })
}

export const seedContextFiles = async (args: {
  deps: HeldSessionDeps
  runtime: SessionRuntime
  record: SessionRecord
}): Promise<ContextSeedOutcome> => {
  if (args.runtime.placeContextFiles === undefined) return { ok: true }
  try {
    const inboxId = firstPostedMessageOf(args.record.eventCache().eventsAfter(0))
    if (inboxId === undefined) return { ok: true }
    const entry = await args.deps.plane.readInboxEntry({
      sessionId: args.deps.sessionId,
      inboxId,
    })
    const files = filesOf(entry)
    if (files.length === 0) return { ok: true }
    return await placeFiles({ runtime: args.runtime, files })
  } catch (error) {
    return { ok: false, reason: `could not read the attached context files: ${messageOf(error)}` }
  }
}

export class ContextSeedGate {
  private seeded = false
  private running: Promise<ContextSeedOutcome> | undefined

  constructor(
    private readonly args: {
      deps: HeldSessionDeps
      runtime(): SessionRuntime | undefined
      record(): SessionRecord | undefined
    },
  ) {}

  ensure(): Promise<ContextSeedOutcome> {
    if (this.seeded) return Promise.resolve({ ok: true })
    if (this.running !== undefined) return this.running
    const runtime = this.args.runtime()
    const record = this.args.record()
    if (runtime === undefined || record === undefined) return Promise.resolve({ ok: true })
    const running = seedContextFiles({ deps: this.args.deps, runtime, record }).then((outcome) => {
      this.running = undefined
      this.seeded = outcome.ok
      return outcome
    })
    this.running = running
    return running
  }
}

export const preparedWithContextFiles = async (args: {
  seed: ContextSeedGate
  result: PrepareResult
  log: LogPort | undefined
  sessionId: string
}): Promise<PrepareResult> => {
  if (!args.result.ok) return args.result
  const seeded = await args.seed.ensure()
  if (seeded.ok) return args.result
  args.log?.error({
    source: 'holder.prepare',
    message: `placing the attached context files of ${args.sessionId} failed`,
    ...logFieldsOf({ error: new Error(seeded.reason) }),
  })
  return { ok: false, reason: seeded.reason }
}
