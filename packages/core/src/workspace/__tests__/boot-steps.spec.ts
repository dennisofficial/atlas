import { describe, expect, it } from 'bun:test'

import { BOOT_STEP_ORDER, EBootStep, EBootStepOutcome, EBootStepState } from '../boot-steps'

const valuesOf = (values: Record<string, string>): string[] => Object.values(values)

describe('boot step vocabulary', () => {
  it('keeps the stored step names', () => {
    expect(valuesOf(EBootStep)).toEqual([
      'provision',
      'serve',
      'clone',
      'setup',
      'context',
      'settings',
      'agent',
    ])
  })

  it('keeps the stored step states', () => {
    expect(valuesOf(EBootStepState)).toEqual(['pending', 'running', 'done', 'error', 'interrupted'])
  })

  it('keeps the stored step outcomes', () => {
    expect(valuesOf(EBootStepOutcome)).toEqual([
      'created',
      'resumed',
      'cloned',
      'reused',
      'no-repository',
      'no-setup-script',
      'setup-script-skipped',
      'setup-script-failed',
    ])
  })

  it('orders settings before setup and context after it', () => {
    expect(BOOT_STEP_ORDER).toEqual([
      EBootStep.Provision,
      EBootStep.Serve,
      EBootStep.Clone,
      EBootStep.Settings,
      EBootStep.Setup,
      EBootStep.Context,
      EBootStep.Agent,
    ])
  })
})
