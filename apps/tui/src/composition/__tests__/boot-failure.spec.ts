import { CloudError } from '@dltech/atlas-harness'
import { describe, expect, it } from 'bun:test'

import { BOOT_FAILURE_EXIT_CODE, bootFailureReport } from '../boot-failure'

describe('what the operator sees when Atlas cannot start', () => {
  it('frames the failure instead of dumping a stack', () => {
    const report = bootFailureReport({
      error: new CloudError({
        status: 500,
        message: 'The Atlas Cloud API answered GET /v1/accounts with 500: Internal server error.',
      }),
      debug: false,
    })

    expect(report).toContain('╭')
    expect(report).toContain('╰')
    expect(report).toContain('Atlas could not start.')
    expect(report).toContain('500: Internal server error.')
    expect(report).not.toContain('cloud-transport.ts')
    expect(report).toContain('ATLAS_DEBUG=1')
  })

  it('keeps the stack reachable behind ATLAS_DEBUG', () => {
    const error = new Error('the database is locked')
    const report = bootFailureReport({ error, debug: true })

    expect(report).toContain(error.stack ?? '')
    expect(report).not.toContain('ATLAS_DEBUG=1')
  })

  it('says what it can about a thrown non-error', () => {
    const report = bootFailureReport({ error: 'nope', debug: false })

    expect(report).toContain('nope')
  })

  it('never wraps a line past the frame it drew', () => {
    const report = bootFailureReport({
      error: new Error('x'.repeat(40) + ' ' + 'y'.repeat(200)),
      debug: false,
    })

    const framed = report.split('\n').filter((line) => line.startsWith('│'))
    const widths = new Set(framed.map((line) => [...line].length))
    expect(widths.size).toBe(1)
    expect([...widths][0]).toBeLessThanOrEqual(92)
  })

  it('exits non-zero', () => {
    expect(BOOT_FAILURE_EXIT_CODE).toBeGreaterThan(0)
  })
})
