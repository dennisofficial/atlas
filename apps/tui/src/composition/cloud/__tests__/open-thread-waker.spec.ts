import { ERunner, toThreadId, type ThreadId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createOpenThreadWaker } from '../open-thread-waker'

const OPEN = toThreadId('thr-open')

function rig(args: { open?: ThreadId | undefined; runner?: ERunner | undefined } = {}) {
  const woken: string[] = []
  const waker = createOpenThreadWaker({
    openThreadId: () => ('open' in args ? args.open : OPEN),
    runnerOf: async () => ('runner' in args ? args.runner : ERunner.Local),
    wakeOpen: () => woken.push('woke'),
  })
  return { waker, woken }
}

describe('createOpenThreadWaker', () => {
  it('wakes the open thread when it runs in a local pod', async () => {
    const { waker, woken } = rig()

    await waker.onWake({ threadId: 'thr-open' })

    expect(woken).toEqual(['woke'])
  })

  it('ignores a wake for a thread that is not open on screen', async () => {
    const { waker, woken } = rig()

    await waker.onWake({ threadId: 'thr-elsewhere' })

    expect(woken).toEqual([])
  })

  it('ignores a wake when no thread is open', async () => {
    const { waker, woken } = rig({ open: undefined })

    await waker.onWake({ threadId: 'thr-open' })

    expect(woken).toEqual([])
  })

  it('leaves a Vercel thread to the API', async () => {
    const { waker, woken } = rig({ runner: ERunner.Vercel })

    await waker.onWake({ threadId: 'thr-open' })

    expect(woken).toEqual([])
  })

  it('ignores a thread this machine does not know', async () => {
    const { waker, woken } = rig({ runner: undefined })

    await waker.onWake({ threadId: 'thr-open' })

    expect(woken).toEqual([])
  })
})
