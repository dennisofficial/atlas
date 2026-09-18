import { afterEach, describe, expect, it } from 'bun:test'

import { EForkMode, toRunId, toThreadId, type EventDraft } from '@dltech/atlas-core'

import { openStoreFixture, type StoreFixture } from './harness'

let fixture: StoreFixture

const threadId = toThreadId('thread-1')
const runId = toRunId('run-1')

const said = (text: string): EventDraft => ({ type: 'user-said', text })

const openFixture = async (): Promise<StoreFixture> => {
  fixture = await openStoreFixture()
  return fixture
}

afterEach(async () => {
  await fixture.close()
})

describe('PrismaEventLog replace', () => {
  it('rebuilds a thread log from scratch under a fresh runId', async () => {
    const { log } = await openFixture()
    const oldRunId = toRunId('run-old')

    const original = await log.append({
      threadId,
      runId: oldRunId,
      drafts: [said('one'), said('two')],
    })

    const replaced = await log.replace({
      threadId,
      runId,
      drafts: [said('a'), said('b'), said('c')],
    })

    expect(replaced.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(replaced.map((event) => event.type === 'user-said' && event.text)).toEqual(['a', 'b', 'c'])
    expect(replaced.every((event) => event.runId === runId)).toBe(true)
    expect(new Set(replaced.map((event) => event.id)).size).toBe(3)
    expect(replaced.some((event) => original.some((old) => old.id === event.id))).toBe(false)
    expect(await log.head({ threadId })).toBe(3)

    const stored = await log.read({ threadId })
    expect(stored.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('does not reuse an id from a context-loaded row it is about to overwrite', async () => {
    const { log } = await openFixture()
    const loaded: EventDraft = {
      type: 'context-loaded',
      slot: 'project-instructions',
      key: '/repo/CLAUDE.md',
      content: 'same content',
    }

    const [original] = await log.append({ threadId, runId, drafts: [loaded] })
    const replaced = await log.replace({ threadId, runId, drafts: [loaded] })

    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.id).not.toBe(original?.id)
    expect(await log.head({ threadId })).toBe(1)
  })

  it('stamps one shared timestamp across the whole batch', async () => {
    const { log } = await openFixture()

    const replaced = await log.replace({ threadId, runId, drafts: [said('a'), said('b')] })

    expect(replaced[0]?.at).toBe(replaced[1]?.at)
  })

  it('goes from empty to nonempty', async () => {
    const { log } = await openFixture()

    const replaced = await log.replace({ threadId, runId, drafts: [said('one')] })

    expect(replaced.map((event) => event.seq)).toEqual([1])
    expect(await log.head({ threadId })).toBe(1)
  })

  it('goes from nonempty to empty, deleting everything and zeroing head', async () => {
    const { log } = await openFixture()

    await log.append({ threadId, runId, drafts: [said('one'), said('two')] })
    const replaced = await log.replace({ threadId, runId, drafts: [] })

    expect(replaced).toEqual([])
    expect(await log.head({ threadId })).toBe(0)
    expect(await log.read({ threadId })).toEqual([])
  })

  it('does not touch another thread when replacing this one', async () => {
    const { log } = await openFixture()
    const other = toThreadId('thread-2')

    await log.append({ threadId: other, runId, drafts: [said('theirs')] })
    await log.append({ threadId, runId, drafts: [said('mine')] })

    await log.replace({ threadId, runId, drafts: [said('replaced')] })

    const untouched = await log.read({ threadId: other })
    expect(untouched.map((event) => event.type === 'user-said' && event.text)).toEqual(['theirs'])
  })

  it('lets a parent chain survive a replace of the child log', async () => {
    const { threads, log } = await openFixture()
    const parent = await threads.create({ title: 'parent' })
    await log.append({
      threadId: parent.id,
      runId,
      drafts: [said('parent one'), said('parent two')],
    })

    const child = await threads.fork({ from: parent.id, seq: 2, mode: EForkMode.Reference })
    await log.append({ threadId: child.id, runId, drafts: [said('child original')] })

    await log.replace({ threadId: child.id, runId, drafts: [said('child replaced')] })

    const composed = await log.read({ threadId: child.id })
    expect(composed.map((event) => event.type === 'user-said' && event.text)).toEqual([
      'parent one',
      'parent two',
      'child replaced',
    ])

    const parentStill = await log.read({ threadId: parent.id })
    expect(parentStill.map((event) => event.type === 'user-said' && event.text)).toEqual([
      'parent one',
      'parent two',
    ])
  })
})
