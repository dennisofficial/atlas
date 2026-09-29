import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it, mock } from 'bun:test'

import { ATLAS_SETTINGS, EExecutionLocation, toThreadId } from '@dltech/atlas-core'
import {
  FileSettingsStore,
  THREAD_META_VERSION,
  atlasDirectory,
  createSettingsService,
  sessionDirectory,
  sessionLockFile,
  threadMetaFile,
  type SettingsBinding,
} from '@dltech/atlas-harness'

const grammarFailure = new Error('the grammar bundle would not load')

let grammarsFail = true

void mock.module('../../ui/markdown/grammars/index', () => ({
  registerGrammars: async (): Promise<void> => {
    if (grammarsFail) throw grammarFailure
  },
}))

const { createBootProgress } = await import('../boot-progress')
const { EOpenMode } = await import('../config')
const { ESession, openSession } = await import('../open-session')

const settings = (): SettingsBinding => ({
  service: createSettingsService({
    definitions: ATLAS_SETTINGS,
    user: new FileSettingsStore({
      file: join(mkdtempSync(join(tmpdir(), 'atlas-open-session-settings-')), 'settings.json'),
      label: 'spec',
    }),
  }),
  bindTo: () => undefined,
})

const readHomeLines = async (): Promise<Record<string, unknown>[]> => {
  const file = join(process.env.ATLAS_HOME ?? '', 'logs.jsonl')
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (text.trim().length > 0) {
      return text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`the boot failure never reached ${file}`)
}

describe('openSession durability', () => {
  it('records a startup failure to the home-level logs.jsonl and still settles as Failed', async () => {
    const session = await openSession({
      config: { model: undefined, executionLocation: undefined, open: { mode: EOpenMode.New }, cwd: process.cwd() },
      command: 'atlas-spec',
      env: { ...process.env, ATLAS_DOCKER_SOCKET: join(process.cwd(), 'no-such-socket') },
      progress: createBootProgress(),
      settings: settings(),
    })

    expect(session.type).toBe(ESession.Failed)

    const lines = await readHomeLines()
    const own = lines.filter(
      (line) => line.source === 'tui.open-session' && line.data !== undefined &&
        (line.data as Record<string, unknown>).command === 'atlas-spec',
    )
    expect(own).toHaveLength(1)
    expect(own[0]?.severity).toBe('error')
    expect(own[0]?.message).toBe('session startup failed')
    expect(own[0]?.error).toBe('the grammar bundle would not load')
    expect(typeof own[0]?.stack).toBe('string')
    expect(own[0]?.data).toEqual({ command: 'atlas-spec', cwd: process.cwd() })
    expect(own[0]?.threadId).toBeUndefined()
  })
})

describe('openSession resuming a thread whose meta says cloud', () => {
  it('settles Ready with the attach pending and never claims the local session lock', async () => {
    grammarsFail = false

    const threadId = toThreadId(`lifted-${process.pid}`)
    const sessionDir = sessionDirectory({ home: atlasDirectory(), sessionId: threadId })
    const metaFile = threadMetaFile({ sessionDir, threadId })
    mkdirSync(dirname(metaFile), { recursive: true })
    writeFileSync(
      metaFile,
      JSON.stringify({
        v: THREAD_META_VERSION,
        id: threadId,
        title: 'the lifted thread',
        head: 0,
        createdAt: '2026-09-20T00:00:00.000Z',
        updatedAt: '2026-09-21T00:00:00.000Z',
        parentThreadId: null,
        forkSeq: null,
        forkMode: null,
        spawnerThreadId: null,
        agentType: null,
        workspace: null,
        repo: null,
        modelRef: null,
        modelEffort: null,
        executionLocation: EExecutionLocation.Cloud,
      }),
    )

    const session = await openSession({
      config: {
        model: undefined,
        executionLocation: undefined,
        open: { mode: EOpenMode.Resume, threadId },
        cwd: process.cwd(),
      },
      command: 'atlas-spec',
      env: { ...process.env, ATLAS_DOCKER_SOCKET: join(process.cwd(), 'no-such-socket') },
      progress: createBootProgress(),
      settings: settings(),
    })

    try {
      expect(session.type).toBe(ESession.Ready)
      if (session.type !== ESession.Ready) return
      expect(session.opened.started).toBe(false)
      expect(session.opened.bootCloudThreadId).toBe(threadId)
      expect(existsSync(sessionLockFile({ sessionDir }))).toBe(false)
    } finally {
      if (session.type === ESession.Ready) await session.app.close()
    }
  }, 60_000)

})
