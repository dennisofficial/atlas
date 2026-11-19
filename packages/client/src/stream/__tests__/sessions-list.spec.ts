import { describe, expect, it } from 'bun:test'

import { streamServerMessageSchema, type StreamSessionRow } from '@dltech/atlas-protocol'

import { createSessionsList } from '../sessions-list'

const rowOf = (sessionId: string): StreamSessionRow => ({
  sessionId,
  projectId: 'p1',
  title: null,
  naming: true,
  mainThreadId: 'thr',
  model: { ref: 'anthropic/claude-opus-5-5', effort: 'high', fast: false },
  createdAt: '2026-11-05T10:00:00.000Z',
  updatedAt: '2026-11-05T10:00:00.000Z',
  archivedAt: null,
})

describe('sessions list', () => {
  it('ignores deltas until the first snapshot arrives', () => {
    const list = createSessionsList()
    let changes = 0
    list.view.subscribe(() => void (changes += 1))
    list.handleMessage({ type: 'upsert', id: 's', row: rowOf('a') })
    list.handleMessage({ type: 'remove', id: 's', sessionId: 'a' })
    expect(list.view.getSnapshot()).toBeUndefined()
    expect(changes).toBe(0)
    list.handleMessage({ type: 'snapshot', id: 's', rows: [rowOf('a'), rowOf('b')] })
    list.handleMessage({ type: 'upsert', id: 's', row: rowOf('c') })
    expect(list.view.getSnapshot()?.map((row) => row.sessionId)).toEqual(['a', 'b', 'c'])
  })

  it('reads a snapshot whose rows carry fields this client does not know', () => {
    const parsed = streamServerMessageSchema.safeParse({
      type: 'snapshot',
      id: 's',
      rows: [{ ...rowOf('a'), addedLater: { status: 'running' } }],
    })
    expect(parsed.success).toBe(true)
  })
})
