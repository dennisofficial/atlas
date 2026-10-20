import { describe, expect, it } from 'bun:test'

import { oversubscriptionWarnings } from '../sandbox'
import { fakeEngine } from './fake-engine'

describe('oversubscriptionWarnings', () => {
  it('warns when the new sandbox has no memory ceiling, because a runaway there takes the daemon down', async () => {
    const { engine } = fakeEngine()

    const warnings = await oversubscriptionWarnings({
      engine,
      prefix: 'atlas',
      adding: { cpus: 0, memoryBytes: 0 },
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('no memory limit')
  })

  it('stays quiet when the new sandbox is capped within the daemon’s headroom', async () => {
    const { engine } = fakeEngine()

    const warnings = await oversubscriptionWarnings({
      engine,
      prefix: 'atlas',
      adding: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
    })

    expect(warnings).toEqual([])
  })
})
