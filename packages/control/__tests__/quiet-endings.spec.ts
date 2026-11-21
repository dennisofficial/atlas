import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EShellEndCause,
  EShellStatus,
  inboxEventOf,
  type EventBody,
} from '@dltech/atlas-core'

import { mint } from '../src/testing/conformance/support'
import { quietEndingRecordsOf } from '../src/quiet-endings'

const TWO_SHELLS_ONE_SERVICE = [
  { type: 'background-shell-started' as const, shellId: 'bash_1', command: 'bun test' },
  { type: 'background-shell-started' as const, shellId: 'bash_2', command: 'bun run build' },
  { type: 'service-started' as const, serviceId: 'svc_1', command: 'bun dev' },
]

const allEnded = (ends: readonly EventBody[]) =>
  mint({ bodies: [...TWO_SHELLS_ONE_SERVICE, ...ends] as never, epoch: 1 })

const shellEnded = (shellId: string): EventBody => ({
  type: 'background-shell-ended',
  shellId,
  command: 'bun test',
  status: EShellStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  cause: EShellEndCause.SandboxStopped,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const serviceEnded = (serviceId: string): EventBody => ({
  type: 'service-ended',
  serviceId,
  command: 'bun dev',
  status: EServiceStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  cause: EShellEndCause.SandboxStopped,
  tail: '',
})

describe('quiet ending records of a closed sandbox', () => {
  it('makes one record entry per unit the log still holds open', () => {
    const records = quietEndingRecordsOf(mint({ bodies: TWO_SHELLS_ONE_SERVICE, epoch: 1 }))

    expect(records.map((record) => record.clientId)).toEqual([
      'background-shell-ended:bash_1',
      'background-shell-ended:bash_2',
      'service-ended:svc_1',
    ])
    const events = records.map((record) => inboxEventOf(record.payload))
    expect(events.every((read) => read.ok)).toBe(true)
    const bodies = events.flatMap((read) => (read.ok ? [read.event] : []))
    expect(bodies).toMatchObject([
      { type: 'background-shell-ended', shellId: 'bash_1', cause: EShellEndCause.SandboxStopped },
      { type: 'background-shell-ended', shellId: 'bash_2', cause: EShellEndCause.SandboxStopped },
      { type: 'service-ended', serviceId: 'svc_1', cause: EShellEndCause.SandboxStopped },
    ])
  })

  it('posts nothing for a second close once the endings are in the log', () => {
    const records = quietEndingRecordsOf(
      allEnded([shellEnded('bash_1'), shellEnded('bash_2'), serviceEnded('svc_1')]),
    )

    expect(records).toEqual([])
  })

  it('leaves a unit alone while its start still has no end', () => {
    const records = quietEndingRecordsOf(allEnded([shellEnded('bash_1')]))

    expect(records.map((record) => record.clientId)).toEqual([
      'background-shell-ended:bash_2',
      'service-ended:svc_1',
    ])
  })
})
