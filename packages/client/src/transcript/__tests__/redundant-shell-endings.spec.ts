import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, toCallId } from '@dltech/atlas-core'

import { durableEntries } from '../durable-entries'
import { EEntryKind, type BackgroundShellEndedEntry } from '../transcript-model'
import { log } from './fixture'

const shellEnded = (over: Record<string, unknown> = {}) => ({
  type: 'background-shell-ended' as const,
  shellId: 'bash_1',
  command: 'bun test',
  description: 'Run the suite',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '261 pass, 0 fail\n',
  droppedCharacters: 0,
  remainingCharacters: 0,
  ...over,
})

const shellKillResult = (args: { output?: Record<string, unknown> } = {}) => ({
  type: 'tool-result' as const,
  callId: toCallId('call-1'),
  name: 'shell_kill',
  output: { shellId: 'bash_1', command: 'bun test', status: 'killed', ...args.output },
})

const endingsOf = (drafts: Parameters<typeof log>[0]): BackgroundShellEndedEntry[] =>
  durableEntries({ events: log(drafts) }).filter(
    (entry): entry is BackgroundShellEndedEntry => entry.kind === EEntryKind.BackgroundShellEnded,
  )

describe('a teardown that re-recorded a shell its turn had already settled', () => {
  it('keeps only the ending that carried the output', () => {
    const endings = endingsOf([
      shellEnded({ output: 'real output\n' }),
      shellEnded({ output: '', killedBy: EKilledBy.SessionEnd }),
    ])

    expect(endings).toHaveLength(1)
    expect(endings[0]?.output).toBe('real output\n')
  })

  it('keeps a session-end ending that no clean ending settled', () => {
    const endings = endingsOf([shellEnded({ killedBy: EKilledBy.SessionEnd })])

    expect(endings).toHaveLength(1)
  })

  it('keeps a fresh shell ending under a recycled id and a different command', () => {
    const endings = endingsOf([
      shellEnded({ command: 'bun test', output: 'one\n' }),
      shellEnded({ command: 'bun run build', output: 'two\n' }),
      shellEnded({ command: 'bun run build', output: '', killedBy: EKilledBy.SessionEnd }),
    ])

    expect(endings.map((ending) => ending.output)).toEqual(['one\n', 'two\n'])
  })
})

describe('a teardown that re-recorded a shell the model had already killed', () => {
  it('hides the silent copy whose kill was delivered as the tool result', () => {
    const endings = endingsOf([
      shellKillResult(),
      shellEnded({ output: '', killedBy: EKilledBy.Model }),
    ])

    expect(endings).toHaveLength(0)
  })

  it('keeps a model-kill ending that carried real output', () => {
    const endings = endingsOf([
      shellKillResult(),
      shellEnded({ output: 'real output\n', killedBy: EKilledBy.Model }),
    ])

    expect(endings).toHaveLength(1)
  })

  it('keeps a silent ending no kill result names', () => {
    const endings = endingsOf([shellEnded({ output: '', killedBy: EKilledBy.Model })])

    expect(endings).toHaveLength(1)
  })

  it('does not let an old kill hide a fresh shell under a recycled id', () => {
    const endings = endingsOf([
      shellKillResult(),
      shellEnded({
        command: 'bun run build',
        output: '',
        killedBy: EKilledBy.Model,
      }),
    ])

    expect(endings).toHaveLength(1)
  })
})
