#!/usr/bin/env bun
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  assemble,
  defaultAnnotators,
  defaultRules,
  EForkMode,
  EMPTY_PROMPT,
  estimateTokens,
  toThreadId,
  type AssembledMessage,
  type Event,
  type EventId,
  type ProviderIdentity,
  type RuleContext,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  eventLogFile,
  ledgerFile,
  parseEventLines,
  readMetaSync,
  sessionsDirectory,
  threadMetaFile,
  threadMetaSchema,
  type ThreadMeta,
} from '@dltech/atlas-harness'
import type { UnreadableRow } from '@dltech/atlas-harness'

const readText = (file: string): string => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

const readFlag = (argv: readonly string[], name: string): string | undefined =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)

const integerFlag = (argv: readonly string[], name: string, fallback: number): number => {
  const raw = readFlag(argv, name)
  const value = raw === undefined ? fallback : Number(raw)
  if (Number.isInteger(value) && value >= 0) return value
  console.error(`--${name} must be a non-negative integer, got "${raw}"`)
  process.exit(1)
}

const parseFlags = (argv: readonly string[]) => {
  const thread = argv.find((arg) => !arg.startsWith('--'))
  if (thread === undefined) {
    console.error('usage: bun apps/tui/scripts/proto-cache-diff.ts <threadId> [--pairs=20] [--from=2026-09-13T16:39] [--detail=4] [--home=path]')
    process.exit(1)
  }
  return {
    home: readFlag(argv, 'home') ?? `${process.env.HOME}/.atlas/sessions`,
    thread,
    pairs: integerFlag(argv, 'pairs', 20),
    from: readFlag(argv, 'from'),
    detail: integerFlag(argv, 'detail', 4),
  }
}

type ThreadRow = Pick<
  ThreadMeta,
  'id' | 'workspace' | 'repo' | 'parentThreadId' | 'forkSeq' | 'forkMode'
>

const allThreadMetas = ({ from }: { from: string }): ThreadMeta[] => {
  const metas: ThreadMeta[] = []
  for (const dir of readdirSync(from)) {
    const threadsDir = join(from, dir, 'threads')
    for (const file of readdirSync(threadsDir).filter((name) => name.endsWith('.meta.json'))) {
      const meta = readMetaSync({ file: join(threadsDir, file), schema: threadMetaSchema })
      if (meta !== undefined) metas.push(meta)
    }
  }
  return metas
}

const threadRow = ({ from, thread }: { from: string; thread: string }): ThreadRow => {
  const found = allThreadMetas({ from }).find(
    (meta) => meta.id === thread || meta.id.startsWith(thread),
  )
  if (found !== undefined) return found
  console.error(`no thread matching "${thread}"`)
  process.exit(1)
}

const sessionDirOf = ({ from, threadId }: { from: string; threadId: string }): string =>
  join(from, threadId)

const composedEvents = ({ from, thread }: { from: string; thread: ThreadRow }): { events: Event[]; unreadable: UnreadableRow[] } => {
  const segments: { threadId: string; upTo: number | undefined }[] = []
  let current: ThreadMeta | undefined = thread as ThreadMeta
  let upTo: number | undefined

  while (current !== undefined) {
    segments.unshift({ threadId: current.id, upTo })
    const parentId: string | null = current.parentThreadId
    const forkSeq = current.forkSeq
    if (current.forkMode !== EForkMode.Reference || parentId === null || forkSeq === null) break
    upTo = upTo === undefined ? forkSeq : Math.min(upTo, forkSeq)
    current = readMetaSync({
      file: threadMetaFile({ sessionDir: sessionDirOf({ from, threadId: parentId }), threadId: parentId as ThreadId }),
      schema: threadMetaSchema,
    })
  }

  const events: Event[] = []
  const unreadable: UnreadableRow[] = []
  for (const segment of segments) {
    const file = eventLogFile({
      sessionDir: sessionDirOf({ from, threadId: segment.threadId }),
      threadId: toThreadId(segment.threadId),
    })
    const parsed = parseEventLines({ text: readText(file), threadId: segment.threadId })
    events.push(...parsed.events.filter((event) => segment.upTo === undefined || event.seq <= segment.upTo))
    unreadable.push(...parsed.unreadable)
  }
  return { events, unreadable }
}

const providerOf = ({ from, threadId }: { from: string; threadId: string }): ProviderIdentity => {
  const raw = readText(ledgerFile({ sessionDir: sessionDirOf({ from, threadId }) }))
  const turns = raw
    .split('\n')
    .filter((line: string) => line !== '')
    .map((line: string) => JSON.parse(line) as { threadId: string; providerId: string; modelId: string; startedAt: string })
    .filter((turn: { threadId: string }) => turn.threadId === threadId)
    .sort((a: { startedAt: string }, b: { startedAt: string }) => b.startedAt.localeCompare(a.startedAt))
  const turn = turns[0]
  return turn === undefined ? { id: 'unknown', modelId: 'unknown' } : { id: turn.providerId, modelId: turn.modelId }
}

const STEP_OUTPUT = new Set(['assistant-said', 'tool-called'])

const requestPoints = (events: readonly Event[]): { index: number; seq: number; at: string }[] =>
  events.flatMap((event, index) => {
    if (!STEP_OUTPUT.has(event.type)) return []
    const before = events[index - 1]
    const sameBatch =
      before !== undefined && STEP_OUTPUT.has(before.type) && before.at === event.at && before.runId === event.runId
    return sameBatch ? [] : [{ index, seq: event.seq, at: event.at }]
  })

type Assembly = { serialized: readonly string[]; entries: readonly AssembledMessage[]; chars: number }

type Replay = {
  threadId: ThreadId; provider: ProviderIdentity; launchDirectory: string; repoRoot: string | undefined
}

const assembleAt = ({ events, threadId, provider, launchDirectory, repoRoot }: Replay & { events: readonly Event[] }): Assembly => {
  const ctx: RuleContext = { events, threadId, step: 0, provider, countTokens: estimateTokens }
  const { assembled } = assemble({
    rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory, repoRoot }),
    annotators: defaultAnnotators(),
    ctx,
  })
  const serialized = assembled.messages.map((entry) => JSON.stringify(entry.message))
  return { serialized, entries: assembled.messages, chars: serialized.reduce((total, text) => total + text.length, 0) }
}

enum EDivergence {
  Identical = 'identical',
  AppendOnly = 'append-only',
  Truncation = 'truncation',
  Deletion = 'deletion',
  Insertion = 'insertion',
  Mutation = 'mutation',
}

type Divergence = {
  kind: EDivergence; index: number; charOffset: number; within: number; span: number
  gone: readonly AssembledMessage[]; fresh: readonly AssembledMessage[]
}

const SHIFT_LIMIT = 12

const shiftOf = ({ from, to, index }: { from: readonly string[]; to: readonly string[]; index: number }): number | undefined => {
  for (let shift = 1; shift <= SHIFT_LIMIT; shift += 1) {
    if (from[index + shift] === undefined) return undefined
    if (from[index + shift] !== to[index]) continue
    const next = to[index + 1]
    if (next === undefined || from[index + shift + 1] === next) return shift
  }
  return undefined
}

const commonPrefix = (left: string, right: string): number => {
  let at = 0
  while (at < left.length && at < right.length && left[at] === right[at]) at += 1
  return at
}

const diffRequests = ({ before, after }: { before: Assembly; after: Assembly }): Divergence => {
  const left = before.serialized
  const right = after.serialized
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1

  const charOffset = left.slice(0, index).reduce((total, text) => total + text.length, 0)
  const base = { index, charOffset, within: 0, span: 0, gone: [], fresh: [] }

  if (index === left.length) {
    return { ...base, kind: index === right.length ? EDivergence.Identical : EDivergence.AppendOnly }
  }
  if (index === right.length) {
    return { ...base, kind: EDivergence.Truncation, span: left.length - index, gone: before.entries.slice(index) }
  }

  const deleted = shiftOf({ from: left, to: right, index })
  const inserted = shiftOf({ from: right, to: left, index })

  if (deleted !== undefined && (inserted === undefined || deleted <= inserted)) {
    return { ...base, kind: EDivergence.Deletion, span: deleted, gone: before.entries.slice(index, index + deleted) }
  }
  if (inserted !== undefined) {
    return { ...base, kind: EDivergence.Insertion, span: inserted, fresh: after.entries.slice(index, index + inserted) }
  }

  const within = commonPrefix(left[index] ?? '', right[index] ?? '')
  return {
    ...base,
    kind: EDivergence.Mutation,
    charOffset: charOffset + within,
    within,
    span: 1,
    gone: before.entries.slice(index, index + 1),
    fresh: after.entries.slice(index, index + 1),
  }
}

const num = (value: number): string => Math.round(value).toLocaleString('en-US')

const tokensFor = (chars: number): number => chars / 4

type Blamed = { entry: AssembledMessage; events: ReadonlyMap<EventId, Event>; full?: boolean }

const describeEvent = ({ entry, events, full = false }: Blamed): string => {
  const event = events.get(entry.origin.eventId)
  if (event === undefined) return `unknown event at seq ${entry.origin.seq}`
  if (event.type !== 'context-loaded') return full ? `${event.type} seq=${event.seq} at=${event.at}` : event.type
  const slotted = `${event.type} slot=${event.slot}`
  return full ? `${slotted} key=${event.key} seq=${event.seq} at=${event.at}` : slotted
}

const excerpt = ({ text, from }: { text: string; from: number }): string =>
  text.slice(Math.max(0, from - 40), Math.max(0, from - 40) + 180).replaceAll('\n', '\\n')

type Detail = { pair: number; divergence: Divergence; after: Assembly; events: ReadonlyMap<EventId, Event> }

const printDetail = ({ pair, divergence, after, events }: Detail): void => {
  const downstream = (1 - divergence.charOffset / after.chars) * 100
  console.log(`\n  pair ${pair}  ${divergence.kind} of ${divergence.span} message(s) at index ${divergence.index}`)
  console.log(
    `    diverges at char ${num(divergence.charOffset)} of ${num(after.chars)} (~${num(tokensFor(divergence.charOffset))} est tokens of ~${num(tokensFor(after.chars))}); ${downstream.toFixed(1)}% of the request sits after it`,
  )
  for (const entry of divergence.gone) {
    console.log(`    gone from the newer request: ${describeEvent({ entry, events, full: true })}`)
    console.log(`      before: ${excerpt({ text: JSON.stringify(entry.message), from: divergence.within })}`)
  }
  for (const entry of divergence.fresh) {
    console.log(`    new in the newer request: ${describeEvent({ entry, events, full: true })}`)
    console.log(`      after : ${excerpt({ text: JSON.stringify(entry.message), from: divergence.within })}`)
  }
}

const flagsOf = parseFlags(process.argv.slice(2))

const main = (): void => {
  const thread = threadRow({ from: flagsOf.home, thread: flagsOf.thread })
  const threadId: ThreadId = toThreadId(thread.id)
  const provider = providerOf({ from: flagsOf.home, threadId: thread.id })
  const decoded = composedEvents({ from: flagsOf.home, thread })

  const events = decoded.events
  const byId = new Map<EventId, Event>(events.map((event) => [event.id, event]))
  const points = requestPoints(events)
  const found = flagsOf.from === undefined ? 0 : points.findIndex((point) => point.at >= (flagsOf.from ?? ''))
  const start = found === -1 ? 0 : found
  const window = points.slice(start, start + flagsOf.pairs + 1)

  console.log(`proto-cache-diff  thread ${thread.id}  provider ${provider.id}/${provider.modelId}`)
  console.log(`  ${events.length} events, ${decoded.unreadable.length} unreadable, ${points.length} request points`)
  console.log(`  diffing ${Math.max(0, window.length - 1)} pairs from request point #${start} (${window[0]?.at ?? 'n/a'})`)
  console.log('  system prompt stubbed empty; live shell/service/agent/execution-location tail blocks not reproduced')

  const replay: Replay = {
    threadId,
    provider,
    launchDirectory: thread.workspace ?? process.cwd(),
    repoRoot: thread.repo ?? undefined,
  }
  const assemblies = window.map((point) => assembleAt({ ...replay, events: events.slice(0, point.index) }))

  console.log('\n  pair  seq A → B      request B at     msgs       kind          diff idx   cached est tokens   after diff %   responsible')
  const kinds = new Map<EDivergence, number>()
  const blamed = new Map<string, number>()
  const details: { pair: number; divergence: Divergence; after: Assembly }[] = []

  for (let pair = 0; pair + 1 < assemblies.length; pair += 1) {
    const before = assemblies[pair]
    const after = assemblies[pair + 1]
    const left = window[pair]
    const right = window[pair + 1]
    if (before === undefined || after === undefined || left === undefined || right === undefined) continue

    const divergence = diffRequests({ before, after })
    kinds.set(divergence.kind, (kinds.get(divergence.kind) ?? 0) + 1)
    const culprits = [...divergence.gone, ...divergence.fresh].map((entry) => describeEvent({ entry, events: byId }))
    for (const culprit of culprits) blamed.set(culprit, (blamed.get(culprit) ?? 0) + 1)

    const downstream = ((1 - divergence.charOffset / after.chars) * 100).toFixed(1)
    console.log(
      `  ${String(pair).padStart(4)}  ${String(left.seq).padStart(5)}→${String(right.seq).padEnd(5)}  ${right.at.slice(5, 19)}   ${String(before.serialized.length).padStart(4)}→${String(after.serialized.length).padEnd(4)}  ${divergence.kind.padEnd(12)}  ${String(divergence.index).padStart(8)}   ${num(tokensFor(divergence.charOffset)).padStart(17)}   ${downstream.padStart(12)}   ${culprits[0] ?? ''}`,
    )
    if (divergence.kind !== EDivergence.AppendOnly && divergence.kind !== EDivergence.Identical) {
      details.push({ pair, divergence, after })
    }
  }

  for (const detail of details.slice(0, flagsOf.detail)) printDetail({ ...detail, events: byId })

  const total = Math.max(0, assemblies.length - 1)
  console.log(`\n  summary: ${(kinds.get(EDivergence.AppendOnly) ?? 0) + (kinds.get(EDivergence.Identical) ?? 0)}/${total} pairs append-only`)
  for (const [kind, count] of [...kinds.entries()].sort((one, other) => other[1] - one[1])) {
    console.log(`    ${kind.padEnd(12)} ${count}`)
  }
  for (const [culprit, count] of [...blamed.entries()].sort((one, other) => other[1] - one[1])) {
    console.log(`    responsible: ${culprit} ×${count}`)
  }
}

main()
