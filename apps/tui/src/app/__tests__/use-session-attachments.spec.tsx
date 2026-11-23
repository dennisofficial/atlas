import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ClipboardImage } from '../../ui/clipboard-image'
import { mountProbe } from '../../ui/hooks/__tests__/mention-reader-fixture'
import { fakeSessionClient, type FakeSessionClient } from './fake-session-client'
import { useSessionAttachments, type SessionAttachments } from '../use-session-attachments'

const UPLOAD_URL = 'https://upload.example.test/1'

const imageOf = (args: { name: string; byteLength: number }): ClipboardImage => {
  const home = mkdtempSync(join(tmpdir(), 'atlas-attachment-'))
  const path = join(home, args.name)
  writeFileSync(path, new Uint8Array(args.byteLength).fill(0x89))
  return {
    path,
    mediaType: 'image/png',
    byteLength: args.byteLength,
    delivery: 'inline' as ClipboardImage['delivery'],
  }
}

type Probe = {
  attachments: SessionAttachments | null
  problems: string[]
}

const probe: Probe = { attachments: null, problems: [] }

function Harness(props: { client: FakeSessionClient }): React.ReactNode {
  probe.attachments = useSessionAttachments({
    api: props.client.api,
    sessionId: 'session-1',
    onProblem: (reason) => probe.problems.push(reason),
  })
  return <text>{probe.attachments.held.length}</text>
}

const mount = async (): Promise<{
  client: FakeSessionClient
  act: (work: () => void | Promise<void>) => Promise<void>
  done: () => Promise<void>
}> => {
  probe.attachments = null
  probe.problems = []
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

const settling = async (
  act: (work: () => void | Promise<void>) => Promise<void>,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

describe('useSessionAttachments', () => {
  test('a picture under the cap is stored as media and rides as one attachment', async () => {
    const stuck = globalThis.fetch
    const put: string[] = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      put.push(String(input))
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const mounted = await mount()
    try {
      await mounted.act(() =>
        attachments().attachImages([imageOf({ name: 'a.png', byteLength: 1024 })]),
      )
      await settling(mounted.act)

      const presigned = mounted.client.calls.presignMedia[0]
      expect(presigned).toBeDefined()
      if (presigned === undefined) throw new Error('media was never presigned')
      expect(presigned.size).toBe(1024)
      expect(presigned.mediaType).toBe('image/png')
      expect(typeof presigned.hash).toBe('string')
      expect(mounted.client.calls.confirmMedia[0]?.hash).toBe(presigned.hash)
      expect(mounted.client.calls.presignUpload).toEqual([])
      expect(put).toEqual([UPLOAD_URL])

      const payload = attachments().payload()
      expect(payload.media).toHaveLength(1)
      expect(payload.media[0]?.id).toBe(`media:${presigned.hash}`)
      expect(payload.media[0]?.name).toBe('a.png')
      expect(payload.media[0]?.content).toEqual({ store: 'media', hash: presigned.hash })
      expect(payload.uploads).toEqual([])
      expect(mounted.client.calls.post).toEqual([])
    } finally {
      globalThis.fetch = stuck
      await mounted.done()
    }
  }, 20_000)

  test('a picture over the cap rides as a composer upload', async () => {
    const stuck = globalThis.fetch
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch

    const mounted = await mount()
    try {
      await mounted.act(() =>
        attachments().attachImages([imageOf({ name: 'huge.png', byteLength: 6 * 1024 * 1024 })]),
      )
      await settling(mounted.act)

      expect(mounted.client.calls.presignMedia).toEqual([])
      expect(mounted.client.calls.presignUpload[0]).toEqual({
        name: 'huge.png',
        size: 6 * 1024 * 1024,
        mediaType: 'image/png',
      })

      const payload = attachments().payload()
      expect(payload.media).toEqual([])
      expect(payload.uploads[0]?.name).toBe('huge.png')
      expect(mounted.client.calls.discardUpload).toEqual([])
    } finally {
      globalThis.fetch = stuck
      await mounted.done()
    }
  }, 20_000)

  test('removing an unsent upload discards it', async () => {
    const stuck = globalThis.fetch
    globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch

    const mounted = await mount()
    try {
      await mounted.act(() =>
        attachments().attachImages([imageOf({ name: 'huge.png', byteLength: 6 * 1024 * 1024 })]),
      )
      await settling(mounted.act)

      const held = attachments().held[0]
      if (held === undefined) throw new Error('the picture was never held')
      await mounted.act(() => attachments().remove(held.id))

      expect(attachments().held).toEqual([])
      expect(mounted.client.calls.discardUpload).toEqual(['composer-uploads/huge.png'])
    } finally {
      globalThis.fetch = stuck
      await mounted.done()
    }
  }, 20_000)

  test('checkSendable is false while an upload is in flight and the send clears it', async () => {
    const stuck = globalThis.fetch
    let release: (() => void) | null = null
    globalThis.fetch = (async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return new Response(null, { status: 200 })
    }) as unknown as typeof fetch

    const mounted = await mount()
    try {
      await mounted.act(() =>
        attachments().attachImages([imageOf({ name: 'a.png', byteLength: 16 })]),
      )
      expect(attachments().checkSendable()).toBe(false)
      expect(attachments().uploading).toBe(true)

      await mounted.act(async () => {
        release?.()
      })
      await settling(mounted.act)

      expect(attachments().checkSendable()).toBe(true)
      await mounted.act(() => attachments().sent())
      expect(attachments().held).toEqual([])
      expect(attachments().payload()).toEqual({ media: [], uploads: [] })
    } finally {
      globalThis.fetch = stuck
      await mounted.done()
    }
  }, 20_000)

  test('a picture that cannot be read is reported and never held', async () => {
    const mounted = await mount()
    try {
      const missing: ClipboardImage = {
        path: join(tmpdir(), 'atlas-no-such-picture', 'gone.png'),
        mediaType: 'image/png',
        byteLength: 16,
        delivery: 'inline' as ClipboardImage['delivery'],
      }

      await mounted.act(() => attachments().attachImages([missing]))

      expect(attachments().held).toEqual([])
      expect(probe.problems).toHaveLength(1)
      expect(probe.problems[0]).toContain('could not attach gone.png')
    } finally {
      await mounted.done()
    }
  }, 20_000)
})
