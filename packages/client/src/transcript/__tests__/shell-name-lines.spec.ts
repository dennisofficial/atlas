import { describe, expect, it } from 'bun:test'

import { EServiceStatus, EShellStatus, type EventOfType } from '@dltech/atlas-core'

import { serviceEndedLine } from '../service-ended-line'
import { shellAwaitingInputLine, shellEndedLine, shellMatchedNoticeLine } from '../shell-ended-line'
import { shellMatchedLine, shellStillRunningEntryLine } from '../shell-lines'
import { log } from './fixture'

type Named = { command: string; description?: string | undefined }

const matched = (named: Named): EventOfType<'background-shell-matched'> => {
  const [event] = log([
    {
      type: 'background-shell-matched',
      shellId: 'shell-1',
      ...named,
      pattern: 'ready',
      lines: 'ready',
      matchCount: 1,
    },
  ])
  if (event?.type !== 'background-shell-matched') throw new Error('the fixture built no match')
  return event
}

const stillRunning = (named: Named): EventOfType<'background-shell-still-running'> => {
  const [event] = log([
    {
      type: 'background-shell-still-running',
      shellId: 'shell-1',
      ...named,
      runningForMs: 60_000,
      silentForMs: 0,
      checkInMs: 60_000,
      tail: '',
    },
  ])
  if (event?.type !== 'background-shell-still-running') throw new Error('the fixture built none')
  return event
}

const lines: readonly { of: string; line: (named: Named) => string; prefix: string }[] = [
  {
    of: 'shellEndedLine',
    line: (named) => shellEndedLine({ ...named, status: EShellStatus.Exited, exitCode: 0 }),
    prefix: 'Background shell ',
  },
  { of: 'shellAwaitingInputLine', line: shellAwaitingInputLine, prefix: 'Background shell ' },
  { of: 'shellMatchedNoticeLine', line: shellMatchedNoticeLine, prefix: 'Background shell ' },
  {
    of: 'serviceEndedLine',
    line: (named) =>
      serviceEndedLine({
        serviceId: 'svc_1',
        ...named,
        status: EServiceStatus.Exited,
        exitCode: 0,
      }),
    prefix: 'Service svc_1 ',
  },
  {
    of: 'shellMatchedLine',
    line: (named) => shellMatchedLine(matched(named)),
    prefix: 'Background shell ',
  },
  {
    of: 'shellStillRunningEntryLine',
    line: (named) => shellStillRunningEntryLine(stillRunning(named)),
    prefix: 'Background shell ',
  },
]

const names: readonly { named: Named; shown: string }[] = [
  { named: { command: 'bun test', description: '  Watch  tests ' }, shown: '"Watch  tests"' },
  { named: { command: 'bun\n  test\t--watch ', description: ' \n ' }, shown: '`bun test --watch`' },
  { named: { command: ' bun test ' }, shown: '`bun test`' },
  {
    named: { command: `${'a'.repeat(60)}\n${'b'.repeat(70)}` },
    shown: `\`${'a'.repeat(60)} ${'b'.repeat(59)}…\``,
  },
]

describe('the name a shell or service line shows', () => {
  for (const { of, line, prefix } of lines) {
    for (const { named, shown } of names) {
      it(`${of} shows ${shown}`, () => {
        expect(line(named).startsWith(`${prefix}${shown} `)).toBe(true)
      })
    }
  }
})
