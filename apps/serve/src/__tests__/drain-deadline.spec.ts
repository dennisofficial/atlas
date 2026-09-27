import { describe, expect, it } from 'bun:test'

import { withDeadline } from '../drain-deadline'

describe('withDeadline', () => {
  it('resolves once the task settles, well inside the deadline', async () => {
    let ran = false
    await withDeadline({
      task: (async () => {
        ran = true
      })(),
      ms: 50,
    })

    expect(ran).toBe(true)
  })

  it('gives up once the deadline lapses, leaving the task to finish on its own', async () => {
    let settled = false
    const stuck = new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true
        resolve()
      }, 30)
    })

    const startedAt = Date.now()
    await withDeadline({ task: stuck, ms: 5 })
    const waited = Date.now() - startedAt

    expect(waited).toBeLessThan(30)
    expect(settled).toBe(false)

    await stuck
    expect(settled).toBe(true)
  })
})
