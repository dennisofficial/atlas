import { describe, expect, it } from 'bun:test'

import { PauseSignal } from '../pause-signal'

describe('a relocation pause signal', () => {
  it('starts unpaused and lets waiters straight through', async () => {
    const pause = new PauseSignal()

    expect(pause.paused).toBe(false)
    await expect(pause.waitIfPaused()).resolves.toBeUndefined()
  })

  it('holds a waiter until the pause lifts', async () => {
    const pause = new PauseSignal()
    pause.pause()

    let released = false
    const waiting = pause.waitIfPaused().then(() => void (released = true))
    await Bun.sleep(1)
    expect(released).toBe(false)

    pause.resume()
    await waiting
    expect(released).toBe(true)
    expect(pause.paused).toBe(false)
  })

  it('holds every waiter, not just the first', async () => {
    const pause = new PauseSignal()
    pause.pause()

    const released: string[] = []
    const first = pause.waitIfPaused().then(() => void released.push('first'))
    const second = pause.waitIfPaused().then(() => void released.push('second'))
    await Bun.sleep(1)
    expect(released).toEqual([])

    pause.resume()
    await Promise.all([first, second])
    expect(released).toEqual(['first', 'second'])
  })

  it('is idempotent: a repeated pause or resume changes nothing', async () => {
    const pause = new PauseSignal()
    pause.pause()
    pause.pause()
    expect(pause.paused).toBe(true)

    pause.resume()
    pause.resume()
    expect(pause.paused).toBe(false)
    await expect(pause.waitIfPaused()).resolves.toBeUndefined()
  })

  it('tells a listener the moment the pause lands, and stops once unsubscribed', () => {
    const pause = new PauseSignal()
    const heard: string[] = []
    const off = pause.onPause(() => heard.push('paused'))

    pause.pause()
    expect(heard).toEqual(['paused'])

    pause.resume()
    pause.pause()
    expect(heard).toEqual(['paused', 'paused'])

    off()
    pause.resume()
    pause.pause()
    expect(heard).toEqual(['paused', 'paused'])
  })

  it('re-pauses after a resume', async () => {
    const pause = new PauseSignal()
    pause.pause()
    pause.resume()
    pause.pause()

    let released = false
    const waiting = pause.waitIfPaused().then(() => void (released = true))
    await Bun.sleep(1)
    expect(released).toBe(false)

    pause.resume()
    await waiting
    expect(released).toBe(true)
  })
})
