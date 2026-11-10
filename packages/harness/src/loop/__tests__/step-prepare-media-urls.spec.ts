import { describe, expect, it } from 'bun:test'

import {
  EAttachmentStore,
  EUploadState,
  messagesFromEvents,
  stampDrafts,
  toEventId,
  toRunId,
  toThreadId,
  type Assembled,
  type Attachment,
  type EventDraft,
  type ImageCapabilities,
  type ModelPort,
  type UploadPlacement,
} from '@dltech/atlas-core'

import type { SaidUploadsPort } from '../../uploads/said-uploads.port'
import { uploadMediaUrls } from '../../uploads/upload-media-urls'
import { prepareStepAssembly } from '../step-prepare'

const threadId = toThreadId('thread-1')
const UPLOAD_ID = '11111111-1111-4111-8111-111111111111'
const PATHNAME = `composer-uploads/user/${UPLOAD_ID}/shot.png`
const SIGNED = 'https://blob.test/get/shot.png?sig=1'

const servedHaiku: ImageCapabilities = {
  images: 'both',
  maxInlineBytes: 5_242_880,
  maxEdge: 8_000,
}

const picture: Attachment = {
  id: UPLOAD_ID,
  name: 'shot.png',
  mediaType: 'image/png',
  size: 8,
  content: { store: EAttachmentStore.Upload, uploadId: UPLOAD_ID, pathname: PATHNAME },
  image: { width: 4, height: 3 },
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

const placed = {
  place: async (): Promise<ReadonlyMap<string, UploadPlacement>> =>
    new Map([[UPLOAD_ID, { state: EUploadState.Ready, path: `/s/uploads/${UPLOAD_ID}/shot.png` }]]),
} as unknown as SaidUploadsPort

const imagesSent = async (found: boolean) => {
  const prepared = await prepareStepAssembly(
    {
      model: {
        identity: { id: 'anthropic', modelId: 'claude-haiku-4-5' },
        traits: () => ({ image: servedHaiku }),
      } as unknown as ModelPort,
      assembly: { rules: [messagesFromEvents()], annotators: [] },
      countTokens: (_assembled: Assembled) => 1,
      hooks: undefined,
      uploads: placed,
      mediaUrls: uploadMediaUrls({
        download: async () =>
          found ? { found: true, downloadUrl: SIGNED, size: 8 } : { found: false },
      }),
      onContext: undefined,
    },
    {
      threadId,
      events: eventsOf([{ type: 'user-said', text: 'what is this?', attachments: [picture] }]),
      step: 0,
      previous: undefined,
    },
  )
  if (!prepared.ok || !('assembled' in prepared)) throw new Error('the step did not assemble')
  const content = prepared.assembled.messages[0]?.message.content
  return Array.isArray(content) ? content.filter((part) => part.type === 'image') : []
}

describe('a serve step with a composer upload', () => {
  it('sends the picture to a url-capable model as a signed link', async () => {
    expect(await imagesSent(true)).toEqual([
      expect.objectContaining({ type: 'image', bytes: { kind: 'url', url: SIGNED } }),
    ])
  })

  it('falls back to the path line, without failing the step, when the upload is gone', async () => {
    expect(await imagesSent(false)).toEqual([])
  })
})
