import {
  canonicalJson,
  chainHash,
  type EventOfType,
  type Hash,
  type MediaRef,
  type RecordEvent,
  type UserContentPart,
} from '@dltech/atlas-core'

export type PictureResolution =
  | { kind: 'media'; media: MediaRef }
  | { kind: 'notKept'; reason: string }

export type PictureResolver = (picture: {
  data: string
  mediaType: string
  source?: string | undefined
}) => Promise<PictureResolution>

type ToolResultEvent = EventOfType<'tool-result'>

type Block = Record<string, unknown>

const asBlock = (value: unknown): Block | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Block)
    : undefined

const carriesInlinePicture = (part: UserContentPart): boolean =>
  part.type === 'image' && part.bytes.kind === 'inline'

const notKeptText = (args: {
  reason: string
  mediaType: string
  source?: string | undefined
}): string => `[picture not kept: ${args.reason}: ${args.source ?? args.mediaType}]`

const rewrittenPart = async (args: {
  part: UserContentPart
  resolve: PictureResolver
}): Promise<UserContentPart> => {
  const { part } = args
  if (part.type !== 'image' || part.bytes.kind !== 'inline') return part
  const resolved = await args.resolve({
    data: part.bytes.data,
    mediaType: part.mediaType,
    ...(part.source === undefined ? {} : { source: part.source }),
  })
  if (resolved.kind === 'notKept')
    return {
      type: 'text',
      text: notKeptText({
        reason: resolved.reason,
        mediaType: part.mediaType,
        ...(part.source === undefined ? {} : { source: part.source }),
      }),
    }
  return {
    type: 'media',
    media: resolved.media,
    ...(part.source === undefined ? {} : { source: part.source }),
    ...(part.providerOptions === undefined ? {} : { providerOptions: part.providerOptions }),
  }
}

const pictureBlocksLeft = (block: Block): boolean =>
  block['type'] === 'image' && typeof block['data'] === 'string'

const strippedBlock = (block: unknown): unknown => {
  const record = asBlock(block)
  if (record === undefined || !pictureBlocksLeft(record)) return block
  const { data: _data, ...rest } = record
  return { ...rest, withheld: true }
}

const strippedOutput = (output: unknown): unknown => {
  const record = asBlock(output)
  if (record === undefined) return output
  const content = record['content']
  if (!Array.isArray(content) || !content.some(pictureBlocksLeft)) return output
  return { ...record, content: content.map(strippedBlock) }
}

const withoutPictures = (event: RecordEvent): string =>
  canonicalJson({ ...event, modelParts: undefined, output: undefined })

export const rewriteEventPictures = async (args: {
  event: RecordEvent
  resolve: PictureResolver
}): Promise<RecordEvent> => {
  if (args.event.type !== 'tool-result') return args.event
  const event = args.event as ToolResultEvent
  const parts = event.modelParts
  const modelParts =
    parts === undefined || !parts.some(carriesInlinePicture)
      ? parts
      : await Promise.all(parts.map((part) => rewrittenPart({ part, resolve: args.resolve })))
  const output = strippedOutput(event.output)
  if (modelParts === parts && output === event.output) return args.event
  const rewritten = {
    ...event,
    ...(modelParts === parts ? {} : { modelParts }),
    ...(output === event.output ? {} : { output }),
  } as RecordEvent
  if (withoutPictures(rewritten) !== withoutPictures(args.event))
    throw new Error(`event ${event.threadId}:${event.seq} changed more than its pictures`)
  return rewritten
}

export type ChainedEventRow = {
  seq: number
  canonical: string
  prevHash: Hash
  hash: Hash
}

export const rechainFrom = (args: {
  events: readonly RecordEvent[]
  prevHash: Hash
}): { events: RecordEvent[]; rows: ChainedEventRow[] } => {
  let prevHash = args.prevHash
  const events: RecordEvent[] = []
  const rows: ChainedEventRow[] = []
  for (const event of args.events) {
    const chained = { ...event, prevHash } as RecordEvent
    const hash = chainHash(chained)
    events.push(chained)
    rows.push({ seq: chained.seq, canonical: canonicalJson(chained), prevHash, hash })
    prevHash = hash
  }
  return { events, rows }
}

export type ChainRow = { seq: number; canonical: string; hash: string }

export const verifyChain = (args: { rows: readonly ChainRow[]; prevHash: Hash }): Hash => {
  let prevHash = args.prevHash
  for (const row of args.rows) {
    const event = JSON.parse(row.canonical) as RecordEvent
    if (event.prevHash !== prevHash)
      throw new Error(`event ${event.threadId}:${row.seq} carries a different prevHash`)
    const hash = chainHash(event)
    if (hash !== row.hash) throw new Error(`event ${event.threadId}:${row.seq} hashes to ${hash}`)
    prevHash = hash
  }
  return prevHash
}

export const inlinePictureCount = (rows: readonly ChainRow[]): number =>
  rows.reduce((total, row) => {
    const event = JSON.parse(row.canonical) as RecordEvent
    if (event.type !== 'tool-result') return total
    const parts = event.modelParts ?? []
    const pictures = parts.filter(carriesInlinePicture).length
    const output = asBlock(event.output)
    const content = output?.['content']
    const blocks = Array.isArray(content) ? content.filter(pictureBlocksLeft).length : 0
    return total + pictures + blocks
  }, 0)
