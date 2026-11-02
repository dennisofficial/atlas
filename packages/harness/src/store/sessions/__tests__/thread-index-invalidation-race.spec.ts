import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import { sessionDirectory, threadMetaFile, threadsDirectory } from '../paths'
import { SessionRegistry } from '../registry'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-index-race-'))
  directories.push(dir)
  return dir
}

async function writeThreadMeta(args: {
  home: string
  sessionId: string
  threadId: string
}): Promise<string> {
  const sessionDir = sessionDirectory({ home: args.home, sessionId: toThreadId(args.sessionId) })
  await mkdir(threadsDirectory({ sessionDir }), { recursive: true })
  await writeFile(
    threadMetaFile({ sessionDir, threadId: toThreadId(args.threadId) }),
    JSON.stringify({
      v: 1,
      id: args.threadId,
      title: null,
      head: 0,
      createdAt: '2026-11-01T23:45:01.598Z',
      updatedAt: '2026-11-01T23:45:01.598Z',
      parentThreadId: null,
      forkSeq: null,
      forkMode: null,
      spawnerThreadId: args.sessionId === args.threadId ? null : args.sessionId,
      agentType: null,
      workspace: null,
      repo: null,
      modelRef: null,
      modelEffort: null,
      executionLocation: null,
      placement: null,
      parkedTranscript: null,
    }),
  )
  return sessionDir
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function lookUpWhileInvalidating(args: {
  registry: SessionRegistry
  threadId: ThreadId
  sessionDir: string
}): Promise<string | undefined> {
  let settled = false
  const lookup = args.registry.sessionDirOf({ threadId: args.threadId }).finally(() => {
    settled = true
  })
  while (!settled) {
    args.registry.invalidateSession({ sessionDir: args.sessionDir })
    await nextMacrotask()
  }
  return lookup
}

describe('a sub-agent thread stays in its spawner session while siblings mirror into it', () => {
  it('resolves to the spawner session even when that session is invalidated mid-scan', async () => {
    const home = await tempHome()
    const rootId = 'brn_8e714c7c-bdb1-43c6-a60d-090b17da90ff'
    const childId = 'brn_edd24b84-1e27-40bd-83d6-98acd19d4afe'
    const sessionDir = await writeThreadMeta({ home, sessionId: rootId, threadId: rootId })
    await writeThreadMeta({ home, sessionId: rootId, threadId: childId })
    for (let index = 0; index < 40; index += 1) {
      const decoy = `brn_decoy-${index.toString().padStart(4, '0')}`
      await writeThreadMeta({ home, sessionId: decoy, threadId: decoy })
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const registry = new SessionRegistry(home)
      const found = await lookUpWhileInvalidating({
        registry,
        threadId: toThreadId(childId),
        sessionDir,
      })
      expect(found).toBe(sessionDir)
    }
  })
})
