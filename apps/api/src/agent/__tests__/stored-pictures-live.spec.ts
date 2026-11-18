import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { MockLanguageModelV4 } from 'ai/test'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'

import {
  EImageTier,
  EUploadState,
  MAX_API_EDGE,
  MAX_INLINE_BYTES,
  assemble,
  attachmentsOf,
  mediaPathname,
  messagesFromEvents,
  resolveMediaUrls,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type MediaRef,
  type ModelCard,
  type RuleContext,
} from '@dltech/atlas-core'
import { DaemonFileSystemPort, RemoteCalls, webSocketConnector } from '@dltech/atlas-host'
import { VercelMediaStore } from '@dltech/atlas-media'
import { daemonToken } from '@dltech/atlas-protocol/engine'

import { signerAttachmentUrls, signerUrls } from '../media/media-urls'
import { MediaSigner } from '../media/media-signer'
import { AiSdkModelPort } from '../model/ai-sdk-model-port'
import { sandboxNameOf } from '../sandbox/sandbox-provider'
import { startDaemon, type RigDaemon } from '../testing/rig-daemon'
import { SandboxSaidUploads } from '../uploads/sandbox-said-uploads'
import { signerUploadBlobs } from '../uploads/upload-blobs'

const token = process.env.BLOB_READ_WRITE_TOKEN
const live = process.env.ATLAS_LIVE_BLOB === '1' && token !== undefined

/** A one-pixel png is enough: what is under test is the path the bytes take, not the picture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** A fresh owner each run: a re-uploaded pathname serves a cached 404 from its earlier life. */
const userId = `probe-${randomUUID().slice(0, 8)}`
const secret = 'probe-daemon-secret'
const sandboxSessionId = 'probe-session'
const threadId = toThreadId('probe-thread')
const sandboxName = sandboxNameOf(sandboxSessionId)
const hash = sha256(new Uint8Array(PNG))

const cardOf = (images: 'both' | 'inline'): ModelCard => ({
  ref: { providerId: 'probe', modelId: 'probe-vision' },
  label: 'probe-vision',
  api: 'anthropic-messages',
  contextWindow: 200_000,
  imageTier: EImageTier.HighResolution,
  image: { images, maxInlineBytes: MAX_INLINE_BYTES, maxEdge: MAX_API_EDGE },
})

describe.skipIf(!live)('a stored picture, live: real blob, real daemon, real prompt', () => {
  let daemon: RigDaemon
  let calls: RemoteCalls
  let store: VercelMediaStore
  let signer: MediaSigner
  const home = mkdtempSync(join(tmpdir(), 'atlas-live-pictures-'))

  beforeAll(async () => {
    daemon = await startDaemon({ sandboxSessionId, secret })
    calls = new RemoteCalls({
      sessionId: sandboxName,
      token: daemonToken({ secret, sandboxName }),
      connector: async () => webSocketConnector({ url: daemon.url }),
      timers: {
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        random: Math.random,
      },
      onFenced: () => {},
    })
    calls.open({ epoch: 1 })
    await calls.ready()

    store = new VercelMediaStore({ token: token ?? '' })
    const windows = new Map<number, { validUntil: number; sealed: string }>()
    signer = new MediaSigner({
      store,
      windows: {
        find: async (windowStart) => windows.get(windowStart) ?? null,
        insertIfAbsent: async (row) => {
          windows.set(row.windowStart, { validUntil: row.validUntil, sealed: row.sealed })
        },
      },
      cipher: { encrypt: (value) => value, decrypt: (value) => value },
      now: () => Date.now(),
    })
  }, 60_000)

  afterAll(async () => {
    await store?.delete({ pathnames: [mediaPathname({ userId, hash })] }).catch(() => undefined)
    try {
      calls?.close()
    } catch {
      // the daemon link is already gone
    }
    await daemon?.stop()
  }, 60_000)

  it('lands the picture in the sandbox, names it, and hands the model bytes it can get', async () => {
    const pathname = mediaPathname({ userId, hash })
    if ((await store.head({ pathname })) === null) {
      const url = await store.presignPut({
        pathname,
        maximumSizeInBytes: MAX_INLINE_BYTES,
        validUntil: Date.now() + 60 * 60 * 1000,
      })
      const written = await fetch(url, {
        method: 'PUT',
        body: PNG,
        headers: { 'content-type': 'image/png', 'x-content-type': 'image/png' },
      })
      expect(written.status).toBeLessThan(300)
    }

    const placements = await new SandboxSaidUploads({
      userId,
      home,
      files: new DaemonFileSystemPort({ calls }),
      blobs: signerUploadBlobs(signer),
    }).place({
      threadId,
      uploads: [],
      mediaFiles: [{ hash, name: 'shot.png', size: PNG.byteLength, mediaType: 'image/png' }],
    })

    const target = `${home}/uploads/${hash}/shot.png`
    expect(placements.get(hash)).toEqual({ state: EUploadState.Ready, path: target })
    expect(sha256(new Uint8Array(readFileSync(target)))).toBe(hash)

    const media: MediaRef = {
      hash,
      mediaType: 'image/png',
      size: PNG.byteLength,
      width: 1,
      height: 1,
    }
    const events = stampDrafts({
      drafts: [
        { type: 'user-said', text: 'what is this?', media: [{ media, source: 'shot.png' }] },
      ],
      envelopes: [
        {
          id: toEventId('event-1'),
          seq: 1,
          threadId,
          runId: toRunId('run-1'),
          depth: 0,
          at: '2026-11-10T00:00:00.000Z',
        },
      ],
    })
    const urls = await resolveMediaUrls({
      attachments: events.flatMap((event) =>
        event.type === 'user-said' ? attachmentsOf(event) : [],
      ),
      threadId,
      resolver: signerAttachmentUrls({ signer, userId }),
    })
    expect(urls.has(`media:${hash}`)).toBe(true)

    const promptFor = async (images: 'both' | 'inline') => {
      const ctx: RuleContext = {
        events,
        threadId,
        step: 0,
        provider: { id: 'probe', modelId: 'probe-vision' },
        imageCapabilities: cardOf(images).image,
        mediaUrls: urls,
        uploads: placements,
      }
      const model = new MockLanguageModelV4({
        supportedUrls: { 'image/*': [/^https:\/\//] },
        doStream: async () => ({
          stream: new ReadableStream<LanguageModelV4StreamPart>({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] })
              controller.enqueue({ type: 'text-start', id: 't' })
              controller.enqueue({ type: 'text-delta', id: 't', delta: 'ok' })
              controller.enqueue({ type: 'text-end', id: 't' })
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              })
              controller.close()
            },
          }),
        }),
      })
      const port = new AiSdkModelPort({
        model,
        identity: { id: 'probe', modelId: 'probe-vision' },
        card: cardOf(images),
        mediaSource: signerUrls({ signer, userId }),
      })
      const { assembled } = assemble({ rules: [messagesFromEvents()], annotators: [], ctx })
      await port.step({
        assembled,
        tools: [],
        signal: new AbortController().signal,
      })
      const prompt = model.doStreamCalls[0]?.prompt ?? []
      return prompt.flatMap((message) => (message.role === 'user' ? message.content : []))
    }

    const textOf = (content: readonly unknown[]): string =>
      content
        .flatMap((part) =>
          (part as { type?: string }).type === 'text' ? [(part as { text: string }).text] : [],
        )
        .join('\n')

    const byUrl = await promptFor('both')
    expect(textOf(byUrl)).toContain(`- ${target} (`)
    expect(textOf(byUrl)).toContain('image/png)')
    const urlPart = byUrl.find((part) => (part as { type?: string }).type === 'file') as
      | { data: { type: string; url?: URL } }
      | undefined
    expect(urlPart?.data.type).toBe('url')
    const fetched = await fetch(urlPart?.data.url ?? 'https://invalid.test')
    expect(sha256(new Uint8Array(await fetched.arrayBuffer()))).toBe(hash)

    const byBytes = await promptFor('inline')
    const bytesPart = byBytes.find((part) => (part as { type?: string }).type === 'file') as
      | { data: { type: string; data?: string } }
      | undefined
    expect(bytesPart?.data).toEqual({ type: 'data', data: PNG.toString('base64') })
  })
})
