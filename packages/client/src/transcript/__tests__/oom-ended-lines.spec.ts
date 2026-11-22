import { describe, expect, it } from 'bun:test'

import { EKilledBy, EServiceStatus, EShellStatus } from '@dltech/atlas-core'

import { serviceEndedLine, serviceEndingFailed } from '../service-ended-line'
import { shellEndedLine, shellEndingFailed } from '../shell-ended-line'

describe('an out-of-memory ending in the transcript', () => {
  it('says a background shell ran out of memory', () => {
    const line = shellEndedLine({
      command: 'bunx turbo run typecheck',
      status: EShellStatus.Killed,
      killedBy: EKilledBy.OutOfMemory,
    })

    expect(line).toBe('Background shell `bunx turbo run typecheck` ran out of memory')
  })

  it('counts a background shell that ran out of memory as failed', () => {
    expect(
      shellEndingFailed({
        command: 'bunx turbo run typecheck',
        status: EShellStatus.Killed,
        killedBy: EKilledBy.OutOfMemory,
      }),
    ).toBe(true)
  })

  it('says a service ran out of memory', () => {
    const line = serviceEndedLine({
      serviceId: 'svc_1',
      command: 'bun run dev',
      status: EServiceStatus.Killed,
      killedBy: EKilledBy.OutOfMemory,
    })

    expect(line).toContain('ran out of memory')
  })

  it('counts a service that ran out of memory as failed', () => {
    expect(
      serviceEndingFailed({ status: EServiceStatus.Killed, killedBy: EKilledBy.OutOfMemory }),
    ).toBe(true)
  })
})
