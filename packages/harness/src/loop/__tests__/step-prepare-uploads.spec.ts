import { describe, expect, it } from 'bun:test'

import {
  defineRule,
  EUploadState,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Assembled,
  type EventDraft,
  type ModelPort,
  type SaidUpload,
  type UploadPlacement,
} from '@dltech/atlas-core'

import type { SaidUploadsPort } from '../../uploads/said-uploads.port'
import { prepareStepAssembly, type StepPrepareDeps } from '../step-prepare'

const threadId = toThreadId('thread-1')

const ID = '8d3f0c1e-1111-4222-8333-444455556666'

const upload: SaidUpload = {
  uploadId: ID,
  pathname: 'p',
  name: 'a.txt',
  size: 1,
  mediaType: 'text/plain',
}

const eventsOf = (drafts: EventDraft[]) =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_draft, index) => ({
      id: toEventId(`event-${index + 1}`),
      seq: index + 1,
      threadId,
      runId: toRunId('run-1'),
      depth: 0,
      at: '2026-01-01T00:00:00.000Z',
    })),
  })

function setup(port: SaidUploadsPort | undefined) {
  const seen: { uploads: ReadonlyMap<string, UploadPlacement> | undefined } = { uploads: undefined }
  const spy = defineRule({
    name: 'spy',
    apply: (input, ctx) => {
      seen.uploads = ctx.uploads
      return input
    },
  })
  const deps: StepPrepareDeps = {
    model: {
      identity: { id: 'x', modelId: 'y' },
      contextWindow: 1_000_000,
    } as unknown as ModelPort,
    assembly: { rules: [spy], annotators: [] },
    countTokens: (_assembled: Assembled) => 1,
    hooks: undefined,
    uploads: port,
    onContext: undefined,
    compact: async () => false,
  }
  return { deps, seen }
}

describe('prepareStepAssembly uploads', () => {
  it('awaits the port and hands its map to assembly', async () => {
    const map = new Map<string, UploadPlacement>([
      [ID, { state: EUploadState.Ready, path: `/s/uploads/${ID}/a.txt` }],
    ])
    const calls: unknown[] = []
    const port = {
      place: async (args: unknown) => {
        calls.push(args)
        return map
      },
    } as unknown as SaidUploadsPort
    const { deps, seen } = setup(port)
    const events = eventsOf([{ type: 'user-said', text: 'hi', uploads: [upload] }])

    await prepareStepAssembly(deps, { threadId, events, step: 0, previous: undefined })

    expect(seen.uploads).toBe(map)
    expect(calls).toEqual([{ threadId, uploads: [upload], currentUploadIds: new Set([ID]) }])
  })

  it('does not call the port when no message carries uploads', async () => {
    let called = false
    const port = {
      place: async () => {
        called = true
        return new Map()
      },
    } as unknown as SaidUploadsPort
    const { deps, seen } = setup(port)
    const events = eventsOf([{ type: 'user-said', text: 'hi' }])

    await prepareStepAssembly(deps, { threadId, events, step: 0, previous: undefined })

    expect(called).toBe(false)
    expect(seen.uploads).toBeUndefined()
  })

  it('treats only uploads after the last assistant output as current', async () => {
    const older = { ...upload, uploadId: '11111111-1111-4222-8333-444455556666' }
    const calls: Array<{ currentUploadIds?: ReadonlySet<string>; signal?: AbortSignal }> = []
    const port = {
      place: async (args: { currentUploadIds?: ReadonlySet<string>; signal?: AbortSignal }) => {
        calls.push(args)
        return new Map()
      },
    } as unknown as SaidUploadsPort
    const { deps } = setup(port)
    const events = eventsOf([
      { type: 'user-said', text: 'old', uploads: [older] },
      { type: 'assistant-said', parts: [{ type: 'text', text: 'ok' }] },
      { type: 'user-said', text: 'new', uploads: [upload] },
    ])
    const controller = new AbortController()

    await prepareStepAssembly(deps, {
      threadId,
      events,
      step: 0,
      previous: undefined,
      signal: controller.signal,
    })

    expect(calls[0]?.currentUploadIds).toEqual(new Set([ID]))
    expect(calls[0]?.signal).toBe(controller.signal)
  })
})
