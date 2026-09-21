import { describe, expect, it } from 'vitest'
import { implementerInstructions, stationSpawnMessageFor } from './station-prompt'

const ARGS = { workItemId: 'fwi_1', runId: 'fsr_abc', repo: 'compai/atlas' }

describe('implementerInstructions', () => {
  it('teaches the git-token broker, the branch rule, and the result endpoint for this run', () => {
    const text = implementerInstructions(ARGS)
    expect(text).toContain('/v1/factory/git-token')
    expect(text).toContain('/v1/factory/stations/fsr_abc/result')
    expect(text).toContain('atlas-factory/')
    expect(text).toContain('main')
    expect(text).toContain('head_sha')
    expect(text).toContain('compai/atlas')
  })

  it('carries the run id so the control plane can use it as the delivery marker', () => {
    expect(implementerInstructions(ARGS)).toContain('fsr_abc')
  })
})

describe('stationSpawnMessageFor', () => {
  it('appends the orchestrator message after the instructions', () => {
    const text = stationSpawnMessageFor({ ...ARGS, message: 'implement the thing verbatim' })
    const [instructions, message] = text.split('\n---\n')
    expect(instructions).toContain('implementer station')
    expect(message).toContain('implement the thing verbatim')
  })
})
