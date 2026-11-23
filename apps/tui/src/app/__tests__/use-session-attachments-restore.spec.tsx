import type { Attachment } from '@dltech/atlas-core'
import { EAttachmentStore } from '@dltech/atlas-core'
import { describe, expect, test } from 'bun:test'
import React from 'react'

import { mountProbe } from '../../ui/hooks/__tests__/mention-reader-fixture'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'
import {
  restoredAttachmentsOf,
  useSessionAttachments,
  type SessionAttachments,
} from '../use-session-attachments'

const MEDIA: Attachment = {
  id: 'media:abc123',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 2048,
  content: { store: EAttachmentStore.Media, hash: 'abc123' },
}

const UPLOAD: Attachment = {
  id: 'upload:upload-shot',
  name: 'huge.png',
  mediaType: 'image/png',
  size: 9_000_000,
  content: {
    store: EAttachmentStore.Upload,
    uploadId: 'upload-shot',
    pathname: 'composer-uploads/huge.png',
  },
}

type Probe = { attachments: SessionAttachments | null }

const probe: Probe = { attachments: null }

function Harness(props: { client: FakeSessionClient }): React.ReactNode {
  probe.attachments = useSessionAttachments({
    api: props.client.api,
    sessionId: 'session-1',
    onProblem: () => undefined,
  })

  return <text>{probe.attachments.held.length}</text>
}

const mounted = async (): Promise<{
  client: FakeSessionClient
  act: (work: () => void | Promise<void>) => Promise<void>
  done: () => Promise<void>
}> => {
  probe.attachments = null
  const client = fakeSessionClient({ onAuthLost: () => undefined })
  const harness = await mountProbe({
    render: (props: { client: FakeSessionClient }) => <Harness {...props} />,
    props: { client },
  })

  return { client, act: harness.act, done: harness.done }
}

const attachments = (): SessionAttachments => {
  if (probe.attachments === null) throw new Error('the probe never mounted')
  return probe.attachments
}

describe('a rewound message coming back as attachments', () => {
  test('a media attachment comes back ready with its hash and no bytes to upload', () => {
    const restored = restoredAttachmentsOf([MEDIA])

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      id: 'media:abc123',
      name: 'shot.png',
      mediaType: 'image/png',
      byteLength: 2048,
      status: 'ready',
      media: { hash: 'abc123' },
    })
  })

  test('an upload attachment comes back ready on its own upload', () => {
    const restored = restoredAttachmentsOf([UPLOAD])

    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      id: 'upload:upload-shot',
      status: 'ready',
      upload: { uploadId: 'upload-shot', pathname: 'composer-uploads/huge.png' },
    })
  })

  test('the next send carries both of them, and neither is uploaded again', async () => {
    const stuck = globalThis.fetch
    const put: string[] = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      put.push(String(input))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const run = await mounted()
    try {
      await run.act(() => attachments().restore([MEDIA, UPLOAD]))
      await run.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      expect(run.client.calls.presignMedia).toEqual([])
      expect(run.client.calls.presignUpload).toEqual([])
      expect(put).toEqual([])

      const payload = attachments().payload()
      expect(payload.media.map((entry) => entry.content)).toEqual([
        { store: 'media', hash: 'abc123' },
      ])
      expect(payload.uploads.map((entry) => entry.uploadId)).toEqual(['upload-shot'])
    } finally {
      globalThis.fetch = stuck
      await run.done()
    }
  }, 20_000)

  test('restoring the same message twice leaves one chip per attachment', async () => {
    const run = await mounted()
    try {
      await run.act(() => attachments().restore([MEDIA]))
      await run.act(() => attachments().restore([MEDIA]))

      expect(attachments().held).toHaveLength(1)
    } finally {
      await run.done()
    }
  }, 20_000)
})
