import { describe, expect, it } from 'bun:test'

import { createSendLock } from '../send-lock'

describe('createSendLock', () => {
  it('sends once when two taps land before the first send settles', async () => {
    const lock = createSendLock()
    const sent: string[] = []
    let spoken: (text: string) => void = () => undefined
    const settling = new Promise<string>((resolve) => {
      spoken = resolve
    })

    const tap = async () => {
      if (!lock.acquire()) return
      try {
        sent.push(await settling)
      } finally {
        lock.release()
      }
    }

    const first = tap()
    const second = tap()
    spoken('Ask not what your country can do')
    await Promise.all([first, second])

    expect(sent).toEqual(['Ask not what your country can do'])
  })

  it('sends the next message once the lock is released', async () => {
    const lock = createSendLock()
    const sent: string[] = []

    const tap = async (text: string) => {
      if (!lock.acquire()) return
      try {
        sent.push(text)
      } finally {
        lock.release()
      }
    }

    await tap('first')
    await tap('second')

    expect(sent).toEqual(['first', 'second'])
  })

  it('releases the lock when the send throws', async () => {
    const lock = createSendLock()

    const tap = async (fails: boolean) => {
      if (!lock.acquire()) return false
      try {
        if (fails) throw new Error('the send died')
        return true
      } finally {
        lock.release()
      }
    }

    await expect(tap(true)).rejects.toThrow('the send died')
    expect(await tap(false)).toBe(true)
  })
})
