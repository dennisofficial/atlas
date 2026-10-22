import { describe, expect, it } from 'bun:test'

import { MainWake } from '../main-wake'

const open = (args: { blocked?: () => boolean } = {}) => {
  const woken: number[] = []
  const blockedCalls: number[] = []
  const wake = new MainWake({
    blocked: () => {
      blockedCalls.push(1)
      return args.blocked?.() ?? false
    },
    onWake: () => woken.push(1),
  })
  return { wake, woken, blockedCalls }
}

describe('a notice arriving while the main thread sits idle', () => {
  it('drives a wake rather than leaving the notice queued for the next message', () => {
    const { wake, woken } = open()

    wake.onNotice({ witness: 'ended:bash_1' })

    expect(woken).toHaveLength(1)
  })

  it('does not wake while a turn is running — the loop drains the same queue itself', () => {
    let turning = true
    const { wake, woken } = open({ blocked: () => turning })

    wake.onNotice({ witness: 'ended:bash_1' })
    expect(woken).toHaveLength(0)

    turning = false
    wake.onNotice({ witness: 'ended:bash_1' })
    expect(woken).toHaveLength(1)
  })

  it('wakes again for the same witness when the wake turn died before draining it', () => {
    const { wake, woken } = open()

    wake.onNotice({ witness: 'ended:bash_1' })
    wake.onNotice({ witness: 'ended:bash_1' })

    expect(woken).toHaveLength(2)
  })

  it('stops after the witness bound so an instantly dying turn cannot spin', () => {
    const { wake, woken } = open()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      wake.onNotice({ witness: 'ended:bash_1' })
    }

    expect(woken).toHaveLength(3)
  })

  it('resets the count when the witness changes — a second shell ending gets its own budget', () => {
    const { wake, woken } = open()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      wake.onNotice({ witness: 'ended:bash_1' })
    }
    wake.onNotice({ witness: 'ended:bash_1 ended:bash_2' })

    expect(woken).toHaveLength(4)
  })

  it('resets the count when the witness drains empty', () => {
    const { wake, woken } = open()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      wake.onNotice({ witness: 'ended:bash_1' })
    }
    wake.onNotice({ witness: null })
    wake.onNotice({ witness: 'ended:bash_1' })

    expect(woken).toHaveLength(4)
  })

  it('never consults the gate when nothing is pending', () => {
    const { wake, blockedCalls } = open()

    wake.onNotice({ witness: null })

    expect(blockedCalls).toHaveLength(0)
  })
})
