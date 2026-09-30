import { open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

import { pullRequestsOf, type Event, type LinkedPullRequest, type ThreadId } from '@dltech/atlas-core'

import { parseEventLines } from './lines'
import { eventLogFile } from './paths'

export type ThreadWorktree = { path: string; branch: string }

export type ThreadPlaces = {
  worktree: ThreadWorktree | null
  pullRequests: LinkedPullRequest[]
}

export type PlaceSegment = {
  threadId: ThreadId
  sessionDir: string
  upTo: number | undefined
}

type FileSignature = { dev: number; ino: number; byteLength: number; modifiedAt: number; changedAt: number }

type CacheEntry = { signature: FileSignature; events: Event[] }

const CACHE_LIMIT = 256

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<Event[]>>()

const READ_BLOCK_BYTES = 65_536

const WORKTREE_EVENT_TYPES = new Set(['worktree-entered', 'worktree-exited', 'directory-changed'])
const PLACE_EVENT_TYPES = new Set([...WORKTREE_EVENT_TYPES, 'pull-request-linked'])

async function signatureOf({ file }: { file: string }): Promise<FileSignature | undefined> {
  const stats = await stat(file).catch(() => undefined)
  if (stats === undefined) return undefined
  return { dev: stats.dev, ino: stats.ino, byteLength: stats.size, modifiedAt: stats.mtimeMs, changedAt: stats.ctimeMs }
}

function sameSignature({ left, right }: { left: FileSignature; right: FileSignature }): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.byteLength === right.byteLength &&
    left.modifiedAt === right.modifiedAt &&
    left.changedAt === right.changedAt
  )
}

type LineState = {
  stage: 'opening' | 'type' | 'rest'
  wanted: boolean
  kept: string
}

function blankLine(): LineState {
  return { stage: 'opening', wanted: false, kept: '' }
}

function topLevelTypeOf({ line }: { line: string }): string | undefined {
  const marker = '"type"'
  let search = 0
  for (;;) {
    const key = line.indexOf(marker, search)
    if (key === -1) return undefined
    let cursor = key + marker.length
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1
    if (line[cursor] !== ':') {
      search = cursor
      continue
    }
    cursor += 1
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1
    if (line[cursor] !== '"') return undefined
    const end = line.indexOf('"', cursor + 1)
    return end === -1 ? undefined : line.slice(cursor + 1, end)
  }
}

async function readPlaceLines({ file }: { file: string }): Promise<string[]> {
  const handle = await open(file, 'r').catch(() => undefined)
  if (handle === undefined) return []
  try {
    const lines: string[] = []
    const decoder = new StringDecoder('utf8')
    const block = Buffer.alloc(READ_BLOCK_BYTES)
    let line = blankLine()
    let offset = 0
    for (;;) {
      const { bytesRead } = await handle.read(block, 0, READ_BLOCK_BYTES, offset)
      if (bytesRead === 0) break
      offset += bytesRead
      let text = decoder.write(block.subarray(0, bytesRead))
      let newline = text.indexOf('\n')
      while (newline !== -1) {
        const piece = text.slice(0, newline)
        line = consumeLinePiece({ line, piece })
        if (line.wanted) lines.push(line.kept)
        line = blankLine()
        text = text.slice(newline + 1)
        newline = text.indexOf('\n')
      }
      if (text !== '') line = consumeLinePiece({ line, piece: text })
    }
    decoder.end()
    return lines
  } finally {
    await handle.close().catch(() => {})
  }
}

function consumeLinePiece({ line, piece }: { line: LineState; piece: string }): LineState {
  if (line.stage === 'rest') return line.wanted ? { ...line, kept: line.kept + piece } : line

  let combined = line.kept + piece
  if (line.stage === 'opening') {
    const probe = combined.trimStart()
    if (probe === '') return { stage: 'opening', wanted: false, kept: combined }
    if (!probe.startsWith('{')) return { stage: 'rest', wanted: false, kept: '' }
    combined = probe
    line = { stage: 'type', wanted: false, kept: combined }
  }

  const type = topLevelTypeOf({ line: combined })
  if (type === undefined) {
    if (combined.length > 4_096) return { stage: 'rest', wanted: false, kept: '' }
    return { stage: 'type', wanted: false, kept: combined }
  }
  const wanted = PLACE_EVENT_TYPES.has(type)
  return { stage: 'rest', wanted, kept: wanted ? combined : '' }
}

async function placeEventsOf({ file, threadId }: { file: string; threadId: ThreadId }): Promise<Event[]> {
  const signature = await signatureOf({ file })
  if (signature === undefined) return []
  const cached = cache.get(file)
  if (cached !== undefined && sameSignature({ left: cached.signature, right: signature })) return cached.events

  const running = inFlight.get(file)
  if (running !== undefined) return running

  const read = (async (): Promise<Event[]> => {
    const lines = await readPlaceLines({ file })
    const after = await signatureOf({ file })
    const events = parseEventLines({ text: lines.join('\n'), threadId }).events.filter((event) =>
      PLACE_EVENT_TYPES.has(event.type),
    )
    if (after !== undefined && sameSignature({ left: signature, right: after })) {
      cache.set(file, { signature, events })
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
    }
    return events
  })()
  inFlight.set(file, read)
  try {
    return await read
  } finally {
    inFlight.delete(file)
  }
}

function worktreeFrom({ segmentEvents }: { segmentEvents: readonly Event[][] }): ThreadWorktree | null {
  for (let index = segmentEvents.length - 1; index >= 0; index -= 1) {
    const latest = (segmentEvents[index] ?? []).filter((event) => WORKTREE_EVENT_TYPES.has(event.type)).at(-1)
    if (latest === undefined) continue
    if (latest.type !== 'worktree-entered') return null
    return { path: latest.path, branch: latest.branch }
  }
  return null
}

function linkedFrom({ segmentEvents }: { segmentEvents: readonly Event[][] }): LinkedPullRequest[] {
  const linked: Event[] = []
  for (const events of segmentEvents) {
    linked.push(...events.filter((event) => event.type === 'pull-request-linked'))
  }
  return [...pullRequestsOf(linked)]
}

export async function placesForSegments({ segments }: { segments: readonly PlaceSegment[] }): Promise<ThreadPlaces> {
  const events = await Promise.all(
    segments.map(async (segment) => {
      const read = await placeEventsOf({
        file: eventLogFile({ sessionDir: segment.sessionDir, threadId: segment.threadId }),
        threadId: segment.threadId,
      })
      return read.filter((event) => segment.upTo === undefined || event.seq <= segment.upTo)
    }),
  )
  return { worktree: worktreeFrom({ segmentEvents: events }), pullRequests: linkedFrom({ segmentEvents: events }) }
}
