import {
  callIdOf,
  classifyTool,
  EToolClass,
  isBarrierEvent,
  isBenignEvent,
  labelOf,
  nameOf,
  parseEnvelope,
  resolveFileInput,
  toolOf,
  type HistoricalEnvelope,
} from './historical-events'
import { applyFileResult, type Anchors, type FileCall } from './historical-apply'
import {
  EHistoricalRejection,
  type HistoricalChange,
  type HistoricalRecovery,
  type HistoricalRejection,
} from './historical-types'

export * from './historical-types'

type Pending = {
  name: string
  runId: string
  threadId: string
  seq: number
  index: number
  toolClass: EToolClass
  file: FileCall | null
  fileRejection: EHistoricalRejection | null
  tainted: boolean
}

const FILE_INPUT_DETAIL = 'file tool input is not a complete absolute-path call'

function duplicatedIds({ envelopes, type }: { envelopes: readonly HistoricalEnvelope[]; type: string }): Set<string> {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const envelope of envelopes) {
    const callId = envelope.type === type ? callIdOf(envelope.body) : null
    if (callId === null) continue
    if (seen.has(callId)) repeated.add(callId)
    seen.add(callId)
  }
  return repeated
}

export function recoverHistoricalChanges({ events }: { events: readonly unknown[] }): HistoricalRecovery {
  const changes: HistoricalChange[] = []
  const rejections: HistoricalRejection[] = []
  const anchors: Anchors = new Map()
  const pending = new Map<string, Pending>()
  const resolved = new Set<string>()

  const parsed = events.map((raw, index) => parseEnvelope({ raw, index }))
  const valid = parsed.filter((entry): entry is HistoricalEnvelope => entry !== null)
  const repeatedCalls = duplicatedIds({ envelopes: valid, type: 'tool-called' })
  const repeatedResults = duplicatedIds({ envelopes: valid, type: 'tool-result' })
  const threadId = valid[0]?.threadId ?? null
  let lastSeq = 0

  const reject = ({ kind, detail, envelope, callId = null, path = null }: { kind: EHistoricalRejection; detail: string; envelope: { index: number; seq: number | null; threadId: string | null }; callId?: string | null; path?: string | null }): void => {
    rejections.push({ kind, detail, index: envelope.index, seq: envelope.seq, threadId: envelope.threadId, callId, path })
  }
  const barrier = (): void => {
    anchors.clear()
    for (const entry of pending.values()) if (entry.file !== null) entry.tainted = true
  }

  parsed.forEach((envelope, index) => {
    if (envelope === null) {
      reject({ kind: EHistoricalRejection.MalformedEvent, detail: 'event is not a valid envelope', envelope: { index, seq: null, threadId: null } })
      barrier()
      return
    }
    if (envelope.threadId !== threadId) {
      reject({ kind: EHistoricalRejection.ThreadMismatch, detail: 'event belongs to a different thread than the log', envelope })
      barrier()
      return
    }
    if (envelope.seq <= lastSeq) {
      reject({ kind: EHistoricalRejection.MalformedEvent, detail: 'event sequence does not increase', envelope })
      barrier()
      return
    }
    lastSeq = envelope.seq
    handleEvent({ envelope })
  })

  function handleEvent({ envelope }: { envelope: HistoricalEnvelope }): void {
    const { type, body } = envelope
    if (type === 'tool-called') return handleCall({ envelope })
    if (type === 'tool-result') return handleResult({ envelope })
    if (type === 'tool-denied') return handleDenied({ envelope })
    if (isBenignEvent({ type })) return
    if (isBarrierEvent({ type })) return barrier()
    reject({ kind: EHistoricalRejection.MalformedEvent, detail: `unrecognised event type ${labelOf({ value: type })}`, envelope, callId: callIdOf(body) })
    barrier()
  }

  function handleCall({ envelope }: { envelope: HistoricalEnvelope }): void {
    const callId = callIdOf(envelope.body)
    const name = nameOf(envelope.body)
    if (callId === null || name === null) {
      reject({ kind: EHistoricalRejection.MalformedEvent, detail: 'tool call lacks a call id or name', envelope })
      return barrier()
    }
    if (repeatedCalls.has(callId) || pending.has(callId) || resolved.has(callId)) {
      reject({ kind: EHistoricalRejection.DuplicateCallId, detail: 'call id is not unique in the log', envelope, callId })
      return barrier()
    }
    const toolClass = classifyTool({ name })
    const tool = toolOf(name)
    const mutating = toolClass !== EToolClass.ReadOnly
    const overlapping = mutating && [...pending.values()].some((entry) => entry.toolClass !== EToolClass.ReadOnly)
    if (overlapping || toolClass === EToolClass.Barrier) barrier()
    const input = tool === null ? null : resolveFileInput({ tool, input: envelope.body['input'] })
    const file: FileCall | null =
      tool !== null && input !== null && input.ok
        ? { tool, path: input.path, content: input.content, threadId: envelope.threadId, runId: envelope.runId, callId, seq: envelope.seq, index: envelope.index }
        : null
    let fileRejection: EHistoricalRejection | null = null
    if (toolClass === EToolClass.File && input !== null && !input.ok) {
      fileRejection = input.unresolvedPath ? EHistoricalRejection.UnresolvedPath : EHistoricalRejection.InvalidInput
    }
    pending.set(callId, {
      name,
      runId: envelope.runId,
      threadId: envelope.threadId,
      seq: envelope.seq,
      index: envelope.index,
      toolClass,
      file,
      fileRejection,
      tainted: overlapping || (toolClass === EToolClass.File && file === null),
    })
  }

  function handleDenied({ envelope }: { envelope: HistoricalEnvelope }): void {
    const callId = callIdOf(envelope.body)
    const entry = callId === null ? undefined : pending.get(callId)
    if (callId === null || entry === undefined) {
      reject({ kind: EHistoricalRejection.OrphanResult, detail: 'denial has no open call', envelope, callId })
      return barrier()
    }
    pending.delete(callId)
    resolved.add(callId)
    if (entry.toolClass !== EToolClass.ReadOnly) {
      reject({ kind: EHistoricalRejection.ToolDenied, detail: 'tool call was denied', envelope, callId, path: entry.file?.path ?? null })
      barrier()
    }
  }

  function handleResult({ envelope }: { envelope: HistoricalEnvelope }): void {
    const { body } = envelope
    const callId = callIdOf(body)
    if (callId === null) {
      reject({ kind: EHistoricalRejection.MalformedEvent, detail: 'tool result lacks a call id', envelope })
      return barrier()
    }
    if (repeatedResults.has(callId) || resolved.has(callId)) {
      reject({ kind: EHistoricalRejection.DuplicateResultId, detail: 'result call id is not unique in the log', envelope, callId })
      pending.delete(callId)
      return barrier()
    }
    const entry = pending.get(callId)
    if (entry === undefined) {
      reject({ kind: EHistoricalRejection.OrphanResult, detail: 'result has no earlier matching call', envelope, callId })
      return barrier()
    }
    pending.delete(callId)
    resolved.add(callId)
    if (entry.toolClass === EToolClass.ReadOnly) return
    const path = entry.file?.path ?? null
    const report = ({ kind, detail }: { kind: EHistoricalRejection; detail: string }): void => reject({ kind, detail, envelope, callId, path })
    if (entry.name !== nameOf(body) || entry.runId !== envelope.runId || entry.threadId !== envelope.threadId) {
      report({ kind: EHistoricalRejection.CallResultMismatch, detail: 'result name, run or thread differs from the call' })
      return barrier()
    }
    if (entry.toolClass === EToolClass.Barrier) return barrier()
    const failed = body['error'] !== undefined
    if (failed || body['interrupted'] === true) {
      const interrupted = body['interrupted'] === true
      report({ kind: interrupted ? EHistoricalRejection.ToolInterrupted : EHistoricalRejection.ToolFailed, detail: interrupted ? 'tool result was interrupted' : 'tool result reports an error' })
      return entry.file === null ? barrier() : void anchors.delete(entry.file.path)
    }
    if (entry.tainted || entry.file === null) {
      const unresolved = entry.fileRejection ?? EHistoricalRejection.InterleavedActivity
      report({ kind: unresolved, detail: entry.file === null ? FILE_INPUT_DETAIL : 'another mutation or opaque call overlapped this call' })
      return barrier()
    }
    const outcome = applyFileResult({ call: entry.file, result: { output: body['output'], seq: envelope.seq, index: envelope.index, at: envelope.at }, anchors })
    if ('change' in outcome) changes.push(outcome.change)
    else report(outcome)
  }

  for (const [callId, entry] of pending) {
    if (entry.toolClass === EToolClass.ReadOnly) continue
    reject({ kind: EHistoricalRejection.MissingResult, detail: 'call has no matching result', envelope: { index: entry.index, seq: entry.seq, threadId: entry.threadId }, callId, path: entry.file?.path ?? null })
  }
  return { changes, rejections }
}
