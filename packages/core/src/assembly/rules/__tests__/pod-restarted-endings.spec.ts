import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellEndCause, EShellStatus } from '../../../shells/status'
import { EServiceStatus } from '../../../services/status'
import { backgroundShellBlock } from '../background-shell-block'
import { serviceEndedBlock } from '../service-ended-block'

const shell = (over: Partial<Parameters<typeof backgroundShellBlock>[0]> = {}) =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-11-21T10:00:00.000Z',
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bun test',
    status: EShellStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    cause: EShellEndCause.PodRestarted,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...over,
  }) as Parameters<typeof backgroundShellBlock>[0]

const service = (over: Partial<Parameters<typeof serviceEndedBlock>[0]> = {}) =>
  ({
    id: 'evt_2',
    seq: 2,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-11-21T10:00:00.000Z',
    type: 'service-ended',
    serviceId: 'svc_1',
    command: 'bun dev',
    status: EServiceStatus.Killed,
    killedBy: EKilledBy.Unrecorded,
    cause: EShellEndCause.PodRestarted,
    tail: '',
    ...over,
  }) as Parameters<typeof serviceEndedBlock>[0]

describe('an ending the pod restart recorded', () => {
  it('tells the model the shell ended with the restarted pod, in its next prompt', () => {
    const block = backgroundShellBlock(shell())

    expect(block).toContain('bash_1')
    expect(block).toContain('The pod restarted, so this shell ended with it.')
    expect(block).toContain('Nothing it was doing failed on its own.')
    expect(block).toContain('Start it again')
    expect(block).not.toContain('The sandbox it ran in stopped')
    expect(block).not.toContain('ended with the sandbox')
  })

  it('tells the model the service ended with the restarted pod, in its next prompt', () => {
    const block = serviceEndedBlock(service())

    expect(block).toContain('svc_1')
    expect(block).toContain('The pod restarted, so this service ended with it.')
    expect(block).toContain('Start it again')
    expect(block).not.toContain('The sandbox it ran in stopped')
    expect(block).not.toContain('ended with the sandbox')
  })

  it('says nothing about a restart for a shell that ended on its own', () => {
    const block = backgroundShellBlock(shell({ cause: undefined, status: EShellStatus.Exited }))

    expect(block).not.toContain('Start it again')
    expect(block).not.toContain('The pod restarted')
  })
})
