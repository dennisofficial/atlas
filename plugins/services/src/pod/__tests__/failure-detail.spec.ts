import { describe, expect, it } from 'bun:test'

import { isParkedOutcome } from '@dltech/atlas-core'

import { invoke, rig, textOf, writeDeclared } from './support'

const failureOf = (outcome: Awaited<ReturnType<typeof invoke>>): string | undefined => {
  if (outcome.ok || isParkedOutcome(outcome)) return undefined
  return outcome.spanDetail?.['service.failure'] as string | undefined
}

describe('the service failure a failed call reports on its span', () => {
  it('is not-declared when the model names a service with no declaration file', async () => {
    const harness = rig()
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web' },
    })

    expect(outcome.ok).toBe(false)
    expect(failureOf(outcome)).toBe('not-declared')
  })

  it('is invalid-declaration when the declaration file does not parse', async () => {
    const harness = rig()
    writeDeclared(harness, 'services:\n  web:\n    command: 3\n')
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web' },
    })

    expect(outcome.ok).toBe(false)
    expect(failureOf(outcome)).toBe('invalid-declaration')
  })

  it('is setup-failed when a declared setup command exits non-zero', async () => {
    const harness = rig()
    writeDeclared(
      harness,
      [
        'services:',
        '  web:',
        '    command: listen',
        '    setup:',
        '      - echo boom; exit 3',
      ].join('\n'),
    )
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'start', name: 'web' },
    })

    expect(outcome.ok).toBe(false)
    expect(textOf(outcome)).toContain('boom')
    expect(failureOf(outcome)).toBe('setup-failed')
  })

  it('is stop-failed when the daemon refuses the stop', async () => {
    const harness = rig()
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'stop', serviceId: 'svc-nope' },
    })

    expect(outcome.ok).toBe(false)
    expect(failureOf(outcome)).toBe('stop-failed')
  })

  it('is not-declared when restart names a service the file does not declare', async () => {
    const harness = rig()
    writeDeclared(harness, ['services:', '  web:', '    command: listen'].join('\n'))
    const outcome = await invoke({
      ctx: harness.ctx,
      name: 'service',
      input: { action: 'restart', name: 'api' },
    })

    expect(outcome.ok).toBe(false)
    expect(failureOf(outcome)).toBe('not-declared')
  })
})
