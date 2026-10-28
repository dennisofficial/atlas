import { toThreadId, type ThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createVisibleThread } from '../visible-thread'

const sourceOf = () => {
  let current: ThreadId | undefined = toThreadId('one')
  const listeners = new Set<() => void>()
  return {
    source: {
      snapshot: () => ({ threadId: current }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    move: (next: ThreadId) => {
      current = next
      for (const listener of listeners) listener()
    },
    listening: () => listeners.size,
  }
}

describe('createVisibleThread', () => {
  it('has no thread until a source is attached', () => {
    expect(createVisibleThread().threadId()).toBeUndefined()
  })

  it('follows the source and tells listeners when the thread moves', () => {
    const visible = createVisibleThread()
    const { source, move } = sourceOf()
    visible.attach(source)
    let heard = 0
    visible.subscribe(() => (heard += 1))

    move(toThreadId('two'))

    expect(visible.threadId()).toBe(toThreadId('two'))
    expect(heard).toBe(1)
  })

  it('lets go of the previous source when a new one is attached', () => {
    const visible = createVisibleThread()
    const first = sourceOf()
    visible.attach(first.source)
    visible.attach(sourceOf().source)

    expect(first.listening()).toBe(0)
  })
})
