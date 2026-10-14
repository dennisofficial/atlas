import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { EArchivePhase, EClientFrame, EClientRequest, type ServeFrame } from '@dltech/atlas-harness'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { archiveProgressReporter, type ArchiveProgressFields } from '../archive-progress'
import { createRequestRouter } from '../socket-requests'
import type { SessionSocket } from '../socket-session'
import { createTurnDriver } from '../turn-driver'
import { fakeServeApp } from './fakes'

const threadId = toThreadId('archive-progress')

const descriptor: SessionArchiveDescriptor = {
  path: '/atlas/home/exports/session-archive-progress-0123456789ab.tar.gz',
  size: 12,
  sha256: 'b'.repeat(64),
  threadId,
}

const routerFixture = (args: {
  broadcastArchiveProgress: (progress: ArchiveProgressFields) => void
  sessionArchive?: Parameters<typeof createRequestRouter>[0]['sessionArchive']
}) => {
  const app = fakeServeApp({ threadId, root: '/workspace' })
  const driver = createTurnDriver({
    app,
    threadId,
    onTurnStarted: () => undefined,
    onTurnEnded: () => undefined,
    onOutcome: () => undefined,
    onFailure: () => undefined,
  })
  const replies = new Map<string, (reply: ServeFrame) => void>()
  const router = createRequestRouter({
    threadId,
    driver,
    files: app.files,
    log: () => undefined,
    snapshot: () => ({ shells: [], agents: [], services: [] }),
    send: ({ frame }) => {
      if (frame.kind === 'reply') replies.get(frame.replyTo)?.(frame)
    },
    broadcastArchiveProgress: args.broadcastArchiveProgress,
    sessionArchive: args.sessionArchive,
  })
  return (op: EClientRequest): Promise<ServeFrame> =>
    new Promise((resolve) => {
      replies.set('r1', resolve)
      router.route({ socket: {} as SessionSocket, frame: { kind: EClientFrame.Request, id: 'r1', op, params: {} } })
    })
}

describe('archive build progress reporter', () => {
  it('maps the builder progress onto the signal fields, carrying the archive kind', () => {
    const seen: ArchiveProgressFields[] = []
    const report = archiveProgressReporter({ archive: 'transcript', broadcast: (p) => seen.push(p), intervalMs: 0 })

    report?.({ phase: 'walking', files: 3, bytes: 0 })
    report?.({ phase: 'compressing', files: 3, bytes: 40, totalBytes: 40 })

    expect(seen).toEqual([
      { archive: 'transcript', phase: EArchivePhase.Walking, files: 3, bytes: 0 },
      { archive: 'transcript', phase: EArchivePhase.Compressing, files: 3, bytes: 40, totalBytes: 40 },
    ])
  })

  it('reports nothing to build when no broadcast is attached', () => {
    expect(archiveProgressReporter({ archive: 'workspace', broadcast: undefined })).toBeUndefined()
  })

  it('never lets a throwing broadcast reach the archive op', () => {
    const report = archiveProgressReporter({
      archive: 'workspace',
      broadcast: () => {
        throw new Error('socket gone')
      },
      intervalMs: 0,
    })

    expect(() => report?.({ phase: 'walking', files: 0, bytes: 0 })).not.toThrow()
  })
})

describe('the router and archive progress', () => {
  it('broadcasts transcript progress while the session archive builds, and still replies with the descriptor', async () => {
    const seen: ArchiveProgressFields[] = []
    const ask = routerFixture({
      broadcastArchiveProgress: (p) => seen.push(p),
      sessionArchive: async (options) => {
        options?.onBuildProgress?.({ phase: 'walking', files: 4, bytes: 0 })
        options?.onBuildProgress?.({ phase: 'staging', files: 1, bytes: 10 })
        options?.onBuildProgress?.({ phase: 'compressing', files: 4, bytes: 90, totalBytes: 90 })
        return descriptor
      },
    })

    const reply = await ask(EClientRequest.ReadSessionArchive)

    expect(reply).toMatchObject({ ok: true, data: { archive: descriptor } })
    expect(seen.map((p) => p.archive)).toEqual(['transcript', 'transcript', 'transcript'])
    expect(seen.map((p) => p.phase)).toEqual([EArchivePhase.Walking, EArchivePhase.Staging, EArchivePhase.Compressing])
    expect(seen[2]).toEqual({
      archive: 'transcript',
      phase: EArchivePhase.Compressing,
      files: 4,
      bytes: 90,
      totalBytes: 90,
    })
  })

  it('answers the archive even when every progress broadcast throws', async () => {
    const ask = routerFixture({
      broadcastArchiveProgress: () => {
        throw new Error('socket gone')
      },
      sessionArchive: async (options) => {
        options?.onBuildProgress?.({ phase: 'walking', files: 1, bytes: 0 })
        return descriptor
      },
    })

    expect(await ask(EClientRequest.ReadSessionArchive)).toMatchObject({ ok: true, data: { archive: descriptor } })
  })
})
