import { describe, expect, it } from 'bun:test'
import {
  canonicalJson,
  chainEvents,
  chainHash,
  toCallId,
  toRunId,
  toThreadId,
  verifySuffix,
  type Hash,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

import { inlinePictureCount, rechainFrom, rewriteEventPictures } from '../rewrite'

const THREAD = toThreadId('thread-pictures')
const RUN = toRunId('run-1')
const AT = '2026-11-25T12:00:00.000Z'

const MEDIA = {
  hash: 'a'.repeat(64),
  mediaType: 'image/png',
  size: 5,
  width: 2,
  height: 2,
} as const

const PICTURE = {
  type: 'image',
  bytes: { kind: 'inline', data: 'aGVsbG8=' },
  mediaType: 'image/png',
  source: 'shot.png',
  providerOptions: { openai: { detail: 'low' } },
} as const

const bodies = (): RecordEventBody[] => [
  { type: 'user-said', text: 'one' },
  {
    type: 'tool-result',
    callId: toCallId('call-1'),
    name: 'read',
    modelParts: [{ type: 'text', text: 'read shot.png' }, PICTURE],
  },
  { type: 'user-said', text: 'two' },
  {
    type: 'tool-result',
    callId: toCallId('call-2'),
    name: 'mcp__files__shot',
    output: {
      content: [
        { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' },
        { type: 'text', text: 'ok' },
      ],
    },
  },
  { type: 'user-said', text: 'three' },
]

const chain = (): RecordEvent[] =>
  chainEvents({ threadId: THREAD, runId: RUN, epoch: 3, bodies: bodies(), at: AT })

const rewriteAll = async (args: {
  events: readonly RecordEvent[]
  resolve: Parameters<typeof rewriteEventPictures>[0]['resolve']
}): Promise<RecordEvent[]> => {
  const out: RecordEvent[] = []
  for (const event of args.events)
    out.push(await rewriteEventPictures({ event, resolve: args.resolve }))
  return out
}

const withoutPictures = (event: RecordEvent): string =>
  canonicalJson({ ...event, modelParts: undefined, output: undefined, prevHash: undefined })

describe('rewriting the pictures a thread carries', () => {
  it('turns an inline part into a media part and strips the MCP block', async () => {
    const events = chain()
    const rewritten = await rewriteAll({
      events,
      resolve: async () => ({ kind: 'media', media: MEDIA }),
    })
    const picture = rewritten[1]

    expect(picture?.type === 'tool-result' ? picture.modelParts : undefined).toEqual([
      { type: 'text', text: 'read shot.png' },
      { type: 'media', media: MEDIA, source: 'shot.png', providerOptions: PICTURE.providerOptions },
    ])
    const mcp = rewritten[3]
    expect(mcp?.type === 'tool-result' ? mcp.output : undefined).toEqual({
      content: [
        { type: 'image', mimeType: 'image/png', withheld: true },
        { type: 'text', text: 'ok' },
      ],
    })
  })

  it('changes nothing outside the pictures of each event', async () => {
    const events = chain()
    const rewritten = await rewriteAll({
      events,
      resolve: async () => ({ kind: 'media', media: MEDIA }),
    })

    expect(rewritten.map(withoutPictures)).toEqual(events.map(withoutPictures))
  })

  it('re-chains every row after the first affected event and still verifies', async () => {
    const events = chain()
    const rewritten = await rewriteAll({
      events,
      resolve: async () => ({ kind: 'media', media: MEDIA }),
    })
    const { events: chained, rows } = rechainFrom({
      events: rewritten.slice(1),
      prevHash: events[1]?.prevHash as Hash,
    })
    const last = chained[chained.length - 1] as RecordEvent

    expect(
      verifySuffix({
        trusted: { seq: 1, hash: chainHash(events[0] as RecordEvent) },
        events: chained,
      }),
    ).toEqual({
      ok: true,
      head: { seq: 5, hash: chainHash(last) },
    })
    expect(rows.map((row) => row.hash)).toEqual(chained.map((event) => chainHash(event)))
    expect(inlinePictureCount(rows)).toBe(0)
  })

  it('names a picture that will not validate and keeps the chain whole', async () => {
    const events = chain()
    const rewritten = await rewriteAll({
      events,
      resolve: async () => ({ kind: 'notKept', reason: 'the image is corrupt' }),
    })
    const picture = rewritten[1]

    expect(picture?.type === 'tool-result' ? picture.modelParts : undefined).toEqual([
      { type: 'text', text: 'read shot.png' },
      { type: 'text', text: '[picture not kept: the image is corrupt: shot.png]' },
    ])
    const { events: chained } = rechainFrom({
      events: rewritten.slice(1),
      prevHash: events[1]?.prevHash as Hash,
    })
    expect(
      verifySuffix({
        trusted: { seq: 1, hash: chainHash(events[0] as RecordEvent) },
        events: chained,
      }).ok,
    ).toBe(true)
  })

  it('hands back the same event once a thread carries no inline picture', async () => {
    const events = chain()
    const rewritten = await rewriteAll({
      events,
      resolve: async () => ({ kind: 'media', media: MEDIA }),
    })
    const again = await rewriteAll({
      events: rewritten,
      resolve: async () => ({ kind: 'media', media: MEDIA }),
    })

    expect(again).toEqual(rewritten)
    for (const [index, event] of again.entries())
      expect(event).toBe(rewritten[index] as RecordEvent)
  })
})
