import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EExecutionLocation, ERunner, toRunId, toThreadId } from '@dltech/atlas-core'
import { call, create, HOME, sharedStore, state, THREAD, useDesktopHost } from './pods-host-fixture'

useDesktopHost()

describe('the shared home', () => {
  test('create writes a normal thread record the TUI reads, and no desktop-pods.json', async () => {
    await create()
    const record = await sharedStore().threads.find({ threadId: toThreadId(THREAD) })
    expect(record).toMatchObject({
      runner: ERunner.Local,
      projectId: 'p1',
      executionLocation: EExecutionLocation.Cloud,
      model: { ref: 'm', effort: 'high' },
    })
    expect(existsSync(join(HOME, 'desktop-pods.json'))).toBe(false)
  })

  test('threads lists a local pod thread the TUI started', async () => {
    const { threads } = sharedStore()
    const fromTui = await threads.create({ workspace: '/Users/dennis/atlas', repo: null })
    await threads.chooseRunner({ threadId: fromTui.id, runner: ERunner.Local })
    const listed = (await (await call({ path: '/desktop/threads' })).json()) as {
      threads: { threadId: string; projectId: string | null }[]
    }
    expect(listed.threads.find((thread) => thread.threadId === fromTui.id)?.projectId).toBeNull()
  })
})

describe('thread history and read state', () => {
  const seed = async (count: number) => {
    await create()
    const { log } = sharedStore()
    await log.append({
      threadId: toThreadId(THREAD),
      runId: toRunId('run-1'),
      drafts: Array.from({ length: count }, (_, index) => ({
        type: 'user-said' as const,
        text: `said ${index + 1}`,
      })),
    })
  }

  test('events pages the local log by seq', async () => {
    await seed(5)
    const first = (await (
      await call({ path: `/desktop/threads/${THREAD}/events?after=0&limit=2` })
    ).json()) as { events: { seq: number }[]; head: number; nextAfter: number | null }
    expect(first.events.map((event) => event.seq)).toEqual([1, 2])
    expect(first).toMatchObject({ head: 5, nextAfter: 2 })
    const last = (await (
      await call({ path: `/desktop/threads/${THREAD}/events?after=4&limit=2` })
    ).json()) as { events: { seq: number }[]; nextAfter: number | null }
    expect(last.events.map((event) => event.seq)).toEqual([5])
    expect(last.nextAfter).toBeNull()
    expect(state.created).toHaveLength(1)
  })

  test('events on an unknown thread is 404 and a bad query is 400', async () => {
    expect((await call({ path: '/desktop/threads/nope/events' })).status).toBe(404)
    await create()
    expect((await call({ path: `/desktop/threads/${THREAD}/events?limit=0` })).status).toBe(400)
  })

  test('mark-read clamps to the head and never moves back', async () => {
    await seed(3)
    expect(await (await call({ path: `/desktop/threads/${THREAD}/read` })).json()).toEqual({
      seq: null,
    })
    const marked = await call({
      path: `/desktop/threads/${THREAD}/read`,
      method: 'POST',
      body: { seq: 99 },
    })
    expect(await marked.json()).toEqual({ seq: 3 })
    const back = await call({
      path: `/desktop/threads/${THREAD}/read`,
      method: 'POST',
      body: { seq: 1 },
    })
    expect(await back.json()).toEqual({ seq: 3 })
  })
})

describe('guarding threads that are not Mac pods', () => {
  test('a fresh pod boots with the chosen model and effort', async () => {
    await create()
    expect(state.bootstraps.join('\n')).toContain('"m"')
    expect(state.bootstraps.join('\n')).toContain('high')
  })

  test('delete leaves a thread that is not a local pod alone', async () => {
    const { threads } = sharedStore()
    const host = await threads.create({ workspace: '/Users/dennis/atlas', repo: null })
    const res = await call({ path: `/desktop/pods/${host.id}`, method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(state.destroyed).toEqual([])
    expect(await sharedStore().threads.find({ threadId: host.id })).toBeDefined()
  })

  test('create refuses to turn an existing thread into a pod', async () => {
    const { threads } = sharedStore()
    const host = await threads.create({ workspace: '/Users/dennis/atlas', repo: null })
    const res = await call({
      path: '/desktop/pods',
      method: 'POST',
      body: { threadId: host.id, projectId: 'p1' },
    })
    expect(res.status).toBe(409)
    const kept = await sharedStore().threads.find({ threadId: host.id })
    expect(kept?.runner).toBeUndefined()
    expect(state.created).toEqual([])
  })
})
