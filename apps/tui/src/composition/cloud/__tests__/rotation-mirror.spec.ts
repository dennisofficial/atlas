import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATLAS_ALLOW_REAL_HOME_ENV,
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'
import {
  buildSessionArchive,
  EClientRequest,
  eventLogFile,
  EVENT_LINE_VERSION,
  parseEventLines,
  readMetaSync,
  sessionDirectory,
  sessionMetaFile,
  sessionMetaSchema,
  threadMetaFile,
  threadMetaSchema,
  type CloudChannel,
  type CloudSandboxes,
} from '@dltech/atlas-harness'

import { mirrorRotationCommit } from '../rotation-mirror'

const PREDECESSOR = toThreadId('predecessor-thread')
const SUCCESSOR = toThreadId('successor-thread')

const ENVELOPE_KEYS = new Set(['id', 'seq', 'threadId', 'runId', 'parentRunId', 'depth', 'at', 'type'])

const encodeLine = (event: Event): string => {
  const body: Record<string, unknown> = { type: event.type }
  for (const [key, value] of Object.entries(event)) {
    if (!ENVELOPE_KEYS.has(key) && value !== undefined) body[key] = value
  }
  return `${JSON.stringify({
    v: EVENT_LINE_VERSION,
    id: event.id,
    seq: event.seq,
    threadId: event.threadId,
    runId: event.runId,
    ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
    depth: event.depth,
    at: event.at,
    type: event.type,
    body,
  })}\n`
}

const eventOn = (args: { threadId: ThreadId; seq: number; type: Event['type']; body: Record<string, unknown> }): Event => ({
  id: toEventId(`e-${args.threadId}-${args.seq}`),
  seq: args.seq,
  threadId: args.threadId,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
  type: args.type,
  ...args.body,
} as Event)

const said = (args: { threadId: ThreadId; seq: number; text: string }): Event =>
  eventOn({ threadId: args.threadId, seq: args.seq, type: 'user-said', body: { text: args.text } })

const writeThread = async (args: {
  home: string
  sessionId: string
  threadId: ThreadId
  events: readonly Event[]
  executionLocation?: EExecutionLocation | undefined
}): Promise<void> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: args.sessionId })
  const file = eventLogFile({ sessionDir, threadId: args.threadId })
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(sessionDir, 'threads'), { recursive: true })
  await writeFile(file, args.events.map(encodeLine).join(''))
  const meta = {
    v: 1,
    id: args.threadId,
    title: null,
    head: args.events.at(-1)?.seq ?? 0,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    parentThreadId: null,
    forkSeq: null,
    forkMode: null,
    spawnerThreadId: null,
    agentType: null,
    workspace: '/workspace/repo',
    repo: null,
    modelRef: null,
    modelEffort: null,
    executionLocation: args.executionLocation ?? null,
    placement: null,
  }
  await writeFile(threadMetaFile({ sessionDir, threadId: args.threadId }), `${JSON.stringify(meta)}\n`)
}

const writeSessionMeta = async (args: { home: string; sessionId: string; activeMainThreadId?: string | undefined }): Promise<void> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: args.sessionId })
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(sessionDir, { recursive: true })
  const meta = {
    format: 1,
    id: args.sessionId,
    title: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    home: 'cloud',
    repo: null,
    workspace: '/workspace/repo',
    worktree: null,
    pullRequests: null,
    spend: null,
    ...(args.activeMainThreadId === undefined ? {} : { activeMainThreadId: args.activeMainThreadId }),
  }
  await writeFile(sessionMetaFile({ sessionDir }), `${JSON.stringify(meta)}\n`)
}

const readEvents = async (args: { home: string; sessionId: string; threadId: ThreadId }): Promise<Event[]> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: args.sessionId })
  const text = await readFile(eventLogFile({ sessionDir, threadId: args.threadId }), 'utf8').catch(() => '')
  return parseEventLines({ text, threadId: args.threadId }).events
}

const readThreadHead = async (args: { home: string; sessionId: string; threadId: ThreadId }): Promise<number | undefined> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: args.sessionId })
  const meta = readMetaSync({ file: threadMetaFile({ sessionDir, threadId: args.threadId }), schema: threadMetaSchema })
  return meta?.head
}

const readSessionMeta = async (args: { home: string; sessionId: string }): Promise<{ activeMainThreadId?: string | null | undefined } | undefined> => {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: args.sessionId })
  return readMetaSync({ file: sessionMetaFile({ sessionDir }), schema: sessionMetaSchema })
}

const exportFromHome = async (home: string) => {
  const built = await buildSessionArchive({
    sessionDir: sessionDirectory({ home, sessionId: PREDECESSOR }),
  })
  if (built === undefined) return null
  return { path: built.path, size: built.size, sha256: built.sha256, threadId: PREDECESSOR }
}

const fakeChannel = (args: { remoteHome: string }): CloudChannel =>
  ({
    threadId: PREDECESSOR,
    connection: () => ({ state: 'open', detail: null }),
    onConnection: () => () => undefined,
    onReload: () => () => undefined,
    onReady: () => () => undefined,
    subscribe: () => () => undefined,
    snapshot: () => [],
    publisherFor: () => {
      throw new Error('no publisher')
    },
    send: () => undefined,
    run: () => undefined,
    interrupt: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    syncSettings: () => undefined,
    request: async (given: { op: EClientRequest; params: unknown }) => {
      if (given.op !== EClientRequest.ReadSessionArchive) return {}
      return { archive: await exportFromHome(args.remoteHome) }
    },
    beginWake: () => undefined,
    wake: () => undefined,
    reconnect: () => undefined,
    close: () => undefined,
  }) as unknown as CloudChannel

const fakeSandboxes = (args: { remoteHome: string }): Pick<CloudSandboxes, 'downloadSession' | 'releaseSession'> => ({
  downloadSession: async ({ destination }) => {
    const descriptor = await exportFromHome(args.remoteHome)
    if (descriptor === null) throw new Error('no archive')
    const { copyFile } = await import('node:fs/promises')
    await copyFile(descriptor.path, destination)
  },
  releaseSession: async () => undefined,
})

describe('mirrorRotationCommit', () => {
  let localHome: string
  let remoteHome: string

  beforeEach(async () => {
    localHome = await mkdtemp(join(tmpdir(), 'atlas-rotation-mirror-local-'))
    remoteHome = await mkdtemp(join(tmpdir(), 'atlas-rotation-mirror-remote-'))
    process.env.ATLAS_HOME = localHome
    process.env[ATLAS_ALLOW_REAL_HOME_ENV] = '1'
  })

  afterEach(async () => {
    delete process.env.ATLAS_HOME
    delete process.env[ATLAS_ALLOW_REAL_HOME_ENV]
    await rm(localHome, { recursive: true, force: true })
    await rm(remoteHome, { recursive: true, force: true })
  })

  it('swaps the successor transcript and stamps ownership', async () => {
    // The sandbox holds: the predecessor log up to the watermark, and the successor seeded with
    // the rotated divider event. Locally the predecessor log still runs past the watermark and
    // the successor does not exist at all.
    await writeThread({
      home: remoteHome,
      sessionId: PREDECESSOR,
      threadId: PREDECESSOR,
      events: [said({ threadId: PREDECESSOR, seq: 1, text: 'before the rotate' })],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeThread({
      home: remoteHome,
      sessionId: PREDECESSOR,
      threadId: SUCCESSOR,
      events: [
        said({ threadId: SUCCESSOR, seq: 1, text: 'the handoff seed' }),
        eventOn({
          threadId: SUCCESSOR,
          seq: 2,
          type: 'rotated',
          body: { predecessor: PREDECESSOR, handoffPath: '/tmp/handoff.md' },
        }),
      ],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeSessionMeta({ home: remoteHome, sessionId: PREDECESSOR, activeMainThreadId: SUCCESSOR })

    await writeThread({
      home: localHome,
      sessionId: PREDECESSOR,
      threadId: PREDECESSOR,
      events: [
        said({ threadId: PREDECESSOR, seq: 1, text: 'before the rotate' }),
        said({ threadId: PREDECESSOR, seq: 2, text: 'typed after the watermark' }),
      ],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeSessionMeta({ home: localHome, sessionId: PREDECESSOR })

    const channel = fakeChannel({ remoteHome })
    const sandboxes = fakeSandboxes({ remoteHome })

    const mirror = await mirrorRotationCommit({ channel, sandboxes, successor: SUCCESSOR, predecessor: PREDECESSOR, localLog: { refresh: async () => undefined } })
    await mirror.seal()

    const successor = await readEvents({ home: localHome, sessionId: PREDECESSOR, threadId: SUCCESSOR })
    expect(successor.map((event) => event.type)).toEqual(['user-said', 'rotated'])

    const predecessor = await readEvents({ home: localHome, sessionId: PREDECESSOR, threadId: PREDECESSOR })
    expect(predecessor.map((event) => event.type)).toEqual(['user-said'])

    expect(await readThreadHead({ home: localHome, sessionId: PREDECESSOR, threadId: SUCCESSOR })).toBe(2)
    expect(await readThreadHead({ home: localHome, sessionId: PREDECESSOR, threadId: PREDECESSOR })).toBe(1)

    const session = await readSessionMeta({ home: localHome, sessionId: PREDECESSOR })
    expect(session?.activeMainThreadId).toBe(SUCCESSOR)

    const successorMeta = readMetaSync({
      file: threadMetaFile({
        sessionDir: sessionDirectory({ home: localHome, sessionId: PREDECESSOR }),
        threadId: SUCCESSOR,
      }),
      schema: threadMetaSchema,
    })
    expect(successorMeta?.executionLocation).toBe(EExecutionLocation.Cloud)
  })

  it('reverts the local files when the swap has to be abandoned', async () => {
    await writeThread({
      home: remoteHome,
      sessionId: PREDECESSOR,
      threadId: PREDECESSOR,
      events: [said({ threadId: PREDECESSOR, seq: 1, text: 'before the rotate' })],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeThread({
      home: remoteHome,
      sessionId: PREDECESSOR,
      threadId: SUCCESSOR,
      events: [said({ threadId: SUCCESSOR, seq: 1, text: 'the handoff seed' })],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeSessionMeta({ home: remoteHome, sessionId: PREDECESSOR, activeMainThreadId: SUCCESSOR })

    await writeThread({
      home: localHome,
      sessionId: PREDECESSOR,
      threadId: PREDECESSOR,
      events: [said({ threadId: PREDECESSOR, seq: 1, text: 'before the rotate' })],
      executionLocation: EExecutionLocation.Cloud,
    })
    await writeSessionMeta({ home: localHome, sessionId: PREDECESSOR })

    const channel = fakeChannel({ remoteHome })
    const sandboxes = fakeSandboxes({ remoteHome })

    const mirror = await mirrorRotationCommit({ channel, sandboxes, successor: SUCCESSOR, predecessor: PREDECESSOR, localLog: { refresh: async () => undefined } })
    await mirror.revert()

    const successor = await readEvents({ home: localHome, sessionId: PREDECESSOR, threadId: SUCCESSOR })
    expect(successor).toHaveLength(0)

    const predecessor = await readEvents({ home: localHome, sessionId: PREDECESSOR, threadId: PREDECESSOR })
    expect(predecessor.map((event) => event.type)).toEqual(['user-said'])
  })
})
