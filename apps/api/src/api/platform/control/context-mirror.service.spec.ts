import { describe, expect, it } from 'bun:test'
import { NotFoundException } from '@nestjs/common'
import { EContextFileKind } from '@dltech/atlas-core'
import { FakeContextContentStore } from '@dltech/atlas-control/testing'
import { LIVE_OP_MAX_BYTES } from '@dltech/atlas-protocol'
import { POD_OPS } from '../../../agent'
import { setupSessionsService } from './sessions.service.fixture'
import { CONTEXT_MIRROR_URL_TTL_MS, ContextMirrorService } from './context-mirror.service'

const setup = async () => {
  const { plane, service: sessions } = setupSessionsService()
  const content = new FakeContextContentStore()
  const mirror = new ContextMirrorService(plane, content, sessions)
  const sessionId = (await sessions.create({ userId: 'user-a', projectId: 'proj-a' })).sessionId
  return { plane, content, mirror, sessions, sessionId }
}

const stage = async (args: {
  plane: Awaited<ReturnType<typeof setup>>['plane']
  content: FakeContextContentStore
  sessionId: string
  path: string
  bytes: Uint8Array
  kind: EContextFileKind
  mime: string
}): Promise<string> => {
  const digest = FakeContextContentStore.hashOf(args.bytes)
  await args.content.put({ hash: digest, bytes: args.bytes })
  await args.plane.upsertContextFiles({
    sessionId: args.sessionId,
    files: [
      {
        path: args.path,
        digest,
        size: args.bytes.byteLength,
        mime: args.mime,
        kind: args.kind,
        mtimeMs: 1_700_000_000_000,
      },
    ],
  })
  return digest
}

const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('ContextMirrorService', () => {
  it('lists the mirrored files of a session by path', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    await stage({
      plane,
      content,
      sessionId,
      path: 'sections/plan.md',
      bytes: textBytes('# Plan'),
      kind: EContextFileKind.Text,
      mime: 'text/markdown',
    })
    await stage({
      plane,
      content,
      sessionId,
      path: 'plan.md',
      bytes: textBytes('# Index'),
      kind: EContextFileKind.Text,
      mime: 'text/markdown',
    })

    const output = await mirror.list({ userId: 'user-a', sessionId })

    expect(output.files.map((file) => file.path)).toEqual(['plan.md', 'sections/plan.md'])
    expect(output.files[0]).toEqual({
      path: 'plan.md',
      size: 7,
      mime: 'text/markdown',
      kind: EContextFileKind.Text,
      mtimeMs: 1_700_000_000_000,
      mirrored: true,
    })
  })

  it('reports a file the mirror has not stored yet', async () => {
    const { plane, mirror, sessionId } = await setup()
    await plane.upsertContextFiles({
      sessionId,
      files: [
        {
          path: 'big.bin',
          digest: null,
          size: 20 * 1024 * 1024,
          mime: 'application/octet-stream',
          kind: EContextFileKind.Binary,
          mtimeMs: 1,
        },
      ],
    })

    const output = await mirror.list({ userId: 'user-a', sessionId })

    expect(output.files).toEqual([
      {
        path: 'big.bin',
        size: 20 * 1024 * 1024,
        mime: 'application/octet-stream',
        kind: EContextFileKind.Binary,
        mtimeMs: 1,
        mirrored: false,
      },
    ])
  })

  it('reads a text file from the mirror', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    await stage({
      plane,
      content,
      sessionId,
      path: 'plan.md',
      bytes: textBytes('# Plan\n\nRead the mirror.'),
      kind: EContextFileKind.Text,
      mime: 'text/markdown',
    })

    const output = await mirror.read({ userId: 'user-a', sessionId, path: 'plan.md' })

    expect(output.file).toEqual({
      type: 'text',
      path: 'plan.md',
      content: '# Plan\n\nRead the mirror.',
      truncated: false,
      bytes: 24,
    })
  })

  it('truncates a text file that runs past the inline cap', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    await stage({
      plane,
      content,
      sessionId,
      path: 'notes.txt',
      bytes: new Uint8Array(LIVE_OP_MAX_BYTES + 10).fill(0x61),
      kind: EContextFileKind.Text,
      mime: 'text/plain',
    })

    const output = await mirror.read({ userId: 'user-a', sessionId, path: 'notes.txt' })

    expect(output.file.type).toBe('text')
    if (output.file.type !== 'text') throw new Error('expected text')
    expect(output.file.truncated).toBe(true)
    expect(output.file.bytes).toBe(LIVE_OP_MAX_BYTES + 10)
    expect(output.file.content.length).toBe(LIVE_OP_MAX_BYTES)
  })

  it('signs a url for an image', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const digest = await stage({
      plane,
      content,
      sessionId,
      path: 'shots/plan.png',
      bytes,
      kind: EContextFileKind.Image,
      mime: 'image/png',
    })

    const output = await mirror.read({ userId: 'user-a', sessionId, path: 'shots/plan.png' })

    expect(output.file).toEqual({
      type: 'image',
      path: 'shots/plan.png',
      mime: 'image/png',
      bytes: 4,
      url: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&contentType=image/png`,
      downloadUrl: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&downloadName=plan.png`,
    })
  })

  it('signs a url for other binary content', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    const digest = await stage({
      plane,
      content,
      sessionId,
      path: 'report.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      kind: EContextFileKind.Binary,
      mime: 'application/pdf',
    })

    const output = await mirror.read({ userId: 'user-a', sessionId, path: 'report.pdf' })

    expect(output.file).toEqual({
      type: 'binary',
      path: 'report.pdf',
      mime: 'application/pdf',
      bytes: 4,
      url: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&contentType=application/pdf`,
      downloadUrl: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&downloadName=report.pdf`,
    })
  })

  it('signs a playable url and a download url for media', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18])
    const cases = [
      {
        path: 'media/walkthrough.mp4',
        kind: EContextFileKind.Video,
        type: 'video' as const,
        mime: 'video/mp4',
      },
      {
        path: 'media/note.m4a',
        kind: EContextFileKind.Audio,
        type: 'audio' as const,
        mime: 'audio/mp4',
      },
    ]

    for (const item of cases) {
      const digest = await stage({ ...item, plane, content, sessionId, bytes })
      const output = await mirror.read({ userId: 'user-a', sessionId, path: item.path })
      const name = item.path.slice(item.path.lastIndexOf('/') + 1)

      expect(output.file).toEqual({
        type: item.type,
        path: item.path,
        mime: item.mime,
        bytes: 4,
        url: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&contentType=${item.mime}`,
        downloadUrl: `fake://changes/${digest}?ttl=${CONTEXT_MIRROR_URL_TTL_MS}&downloadName=${name}`,
      })
    }
  })

  it('answers pending for a file the mirror never stored', async () => {
    const { plane, mirror, sessionId } = await setup()
    await plane.upsertContextFiles({
      sessionId,
      files: [
        {
          path: 'huge.zip',
          digest: null,
          size: 12 * 1024 * 1024,
          mime: 'application/octet-stream',
          kind: EContextFileKind.Binary,
          mtimeMs: 1,
        },
      ],
    })

    const output = await mirror.read({ userId: 'user-a', sessionId, path: 'huge.zip' })

    expect(output.file).toEqual({ type: 'pending', path: 'huge.zip' })
  })

  it('answers not found for a path the mirror does not index', async () => {
    const { mirror, sessionId } = await setup()

    const outcome = mirror.read({ userId: 'user-a', sessionId, path: 'missing.md' })

    await expect(outcome).rejects.toBeInstanceOf(NotFoundException)
  })

  it('answers not found for another user’s session', async () => {
    const { plane, content, mirror, sessionId } = await setup()
    await stage({
      plane,
      content,
      sessionId,
      path: 'plan.md',
      bytes: textBytes('# Plan'),
      kind: EContextFileKind.Text,
      mime: 'text/markdown',
    })

    await expect(mirror.list({ userId: 'user-b', sessionId })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    await expect(
      mirror.read({ userId: 'user-b', sessionId, path: 'plan.md' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('holds no pod dependency', async () => {
    const injected = Reflect.getMetadata('self:paramtypes', ContextMirrorService) as
      | readonly { index: number; param: unknown }[]
      | undefined

    expect(ContextMirrorService.length).toBe(3)
    expect((injected ?? []).some((entry) => entry.param === POD_OPS)).toBe(false)
  })
})
