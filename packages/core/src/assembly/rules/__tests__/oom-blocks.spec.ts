import { describe, expect, it } from 'bun:test'

import { EOomScope, type OomMemory } from '../../../pod/pod-oom'
import { EKilledBy, EShellStatus } from '../../../shells/status'
import { EServiceStatus } from '../../../services/status'
import { backgroundShellBlock } from '../background-shell-block'
import { podOomBlock } from '../pod-oom-block'
import { serviceEndedBlock } from '../service-ended-block'

const MEMORY: OomMemory = { commandLimitBytes: 2_490_195_968, podBytes: 4_100_808_704 }
const LIMIT_PHRASE = "commands may use 2.3 GB of the pod's 4 GB"

const endedShell = (over: Partial<Parameters<typeof backgroundShellBlock>[0]> = {}) =>
  ({
    id: 'evt_1',
    seq: 1,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-08-27T12:00:00.000Z',
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bunx turbo run typecheck',
    status: EShellStatus.Killed,
    killedBy: EKilledBy.OutOfMemory,
    output: '',
    droppedCharacters: 0,
    remainingCharacters: 0,
    ...over,
  }) as Parameters<typeof backgroundShellBlock>[0]

const endedService = (over: Partial<Parameters<typeof serviceEndedBlock>[0]> = {}) =>
  ({
    id: 'evt_2',
    seq: 2,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-08-27T12:00:00.000Z',
    type: 'service-ended',
    serviceId: 'svc_1',
    command: 'bun run dev',
    status: EServiceStatus.Killed,
    killedBy: EKilledBy.OutOfMemory,
    tail: '',
    ...over,
  }) as Parameters<typeof serviceEndedBlock>[0]

const oomIncident = (over: Partial<Parameters<typeof podOomBlock>[0]> = {}) =>
  ({
    id: 'evt_3',
    seq: 3,
    threadId: 'br_1',
    runId: 'run_1',
    depth: 0,
    at: '2026-08-27T12:00:00.000Z',
    type: 'pod-ran-out-of-memory',
    incidentId: 'oom-1',
    scope: EOomScope.Pod,
    processes: 2,
    memory: MEMORY,
    ...over,
  }) as Parameters<typeof podOomBlock>[0]

describe('an out-of-memory ending told to the model', () => {
  it('gives a killed background shell the command limit and tells it not to resize the pod', () => {
    const block = backgroundShellBlock(endedShell({ memory: MEMORY }))

    expect(block).toContain('ran out of memory')
    expect(block).toContain(LIMIT_PHRASE)
    expect(block).toContain('Only the operator can give the pod more memory')
  })

  it('gives a killed service the command limit and tells it not to resize the pod', () => {
    const block = serviceEndedBlock(endedService({ memory: MEMORY }))

    expect(block).toContain('ran out of memory')
    expect(block).toContain(LIMIT_PHRASE)
    expect(block).toContain('Only the operator can give the pod more memory')
  })

  it('leaves the limit out when the daemon sent none', () => {
    const block = backgroundShellBlock(endedShell())

    expect(block).toContain('ran out of memory')
    expect(block).not.toContain(LIMIT_PHRASE)
  })

  it('tells the model about an unowned kill on the pod', () => {
    const block = podOomBlock(oomIncident())

    expect(block).toContain('Pod ran out of memory: the kernel killed')
    expect(block).toContain(LIMIT_PHRASE)
    expect(block).toContain('Only the operator can give the pod more memory')
  })

  it('says nothing for a kill a command already reported in its own result', () => {
    expect(
      podOomBlock(oomIncident({ scope: EOomScope.Command, command: 'bun test', processes: 1 })),
    ).toBeUndefined()
  })
})
