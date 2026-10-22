import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'

import { registryFor } from '../../store/sessions/registry'
import { sessionDirectory } from '../../store/sessions/paths'
import { createSessionContextReader } from '../session-context'

const READY_SENTINEL = '.ready'

const WARM_UP_MS = 1_500

const WARM_UP_PACE_MS = 10

const homes: string[] = []
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-context-session-'))
  homes.push(home)
  const root = toThreadId('root')
  const child = toThreadId('child')
  const sessionDir = sessionDirectory({ home, sessionId: root })
  const registry = registryFor({ home })
  registry.registerThread({ sessionDir, threadId: root })
  registry.registerThread({ sessionDir, threadId: child })
  return { home, root, child, sessionDir }
}

describe('session context reader', () => {
  it('resolves the shared root for a child thread, not a second context directory', async () => {
    const { home, root, child, sessionDir } = await fixture()
    await mkdir(join(sessionDir, 'context'), { recursive: true })
    await writeFile(join(sessionDir, 'context', 'plan.md'), 'shared plan')
    for (const threadId of [root, child]) {
      const reader = createSessionContextReader({ home, threadId })
      expect(await reader.list()).toEqual([{ name: 'plan.md', isDirectory: false }])
      expect(await reader.load('plan.md')).toEqual({
        type: 'text',
        content: 'shared plan',
        truncated: false,
      })
    }
  })

  it('notifies when context is created after the sidebar subscribed', async () => {
    const { home, root, sessionDir } = await fixture()
    await mkdir(sessionDir, { recursive: true })
    const reader = createSessionContextReader({ home, threadId: root })
    const context = join(sessionDir, 'context')
    const removed = Promise.withResolvers<void>()
    const created = Promise.withResolvers<void>()
    let ready = false
    let awaitingRemoval = false
    const handleChange = () => {
      void reader.list().then((entries) => {
        if (entries.some((entry) => entry.name === READY_SENTINEL)) ready = true
        if (awaitingRemoval && entries.length === 0) removed.resolve()
        if (entries.some((entry) => entry.name === 'notes.md')) created.resolve()
      }, created.reject)
    }
    const stop = reader.subscribe(handleChange)
    try {
      expect(await reader.list()).toEqual([])
      await mkdir(context)
      const warmUpEnds = performance.now() + WARM_UP_MS
      while (!ready && performance.now() < warmUpEnds) {
        await writeFile(join(context, READY_SENTINEL), 'ready')
        await Bun.sleep(WARM_UP_PACE_MS)
      }
      expect(ready).toBe(true)

      awaitingRemoval = true
      await rm(context, { recursive: true })
      await removed.promise

      await mkdir(context)
      await writeFile(join(context, 'notes.md'), 'new note')
      await created.promise
      expect(await reader.list()).toEqual([{ name: 'notes.md', isDirectory: false }])
    } finally {
      stop()
    }
  }, 5000)
})
