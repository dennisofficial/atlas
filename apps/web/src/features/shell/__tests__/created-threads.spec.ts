import { describe, expect, it } from 'bun:test'

import { createCreatedThreads, withCreatedThreads } from '../created-threads'
import { projectOf, sessionOf, threadOf } from './fixtures'

const idsOf = (list: { sessions: { mainThread: { id: string } }[] }[]) =>
  list.map((entry) => entry.sessions.map((session) => session.mainThread.id))

describe('withCreatedThreads', () => {
  const entries = [
    { project: projectOf('p1'), sessions: [sessionOf(threadOf({ id: 'old', projectId: 'p1' }))] },
    { project: projectOf('p2'), sessions: [] },
  ]

  it('lists a just-created thread in its project before the server list has it', () => {
    const created = threadOf({ id: 'new', sessionId: 'ses_new', projectId: 'p2' })
    const merged = withCreatedThreads({ entries, created: [created] })
    expect(idsOf(merged)).toEqual([['old'], ['new']])
    expect(merged[1]?.sessions[0]?.id).toBe('ses_new')
  })

  it('does not duplicate a thread the server list already holds', () => {
    const created = threadOf({ id: 'old', projectId: 'p1' })
    expect(withCreatedThreads({ entries, created: [created] })).toBe(entries)
  })

  it('leaves the list alone when the thread has no listed project', () => {
    const created = threadOf({ id: 'new', projectId: null })
    expect(withCreatedThreads({ entries, created: [created] })).toBe(entries)
  })
})

describe('createCreatedThreads', () => {
  it('holds announced threads until they are forgotten', () => {
    const store = createCreatedThreads()
    const thread = threadOf({ id: 'new', projectId: 'p1' })
    let emitted = 0
    store.subscribe(() => (emitted += 1))
    store.announce(thread)
    expect(store.snapshot()).toEqual([thread])
    store.forgetListed([{ project: projectOf('p1'), sessions: [sessionOf(thread)] }])
    expect(store.snapshot()).toEqual([])
    expect(emitted).toBe(2)
  })
})
