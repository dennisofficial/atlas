import { describe, expect, it } from 'bun:test'

import { bashExecOutcomeOf, bashSpanDetailOf, EBashExecOutcome } from '../bash-span-detail'

describe('bashSpanDetailOf', () => {
  it('names the program and keeps the rest of the command out', () => {
    const detail = bashSpanDetailOf({
      command: 'curl -H "Authorization: Bearer sk-live-1234" https://example.com',
      outcome: EBashExecOutcome.Exit,
      exitCode: 2,
      durationMs: 41.6,
    })

    expect(detail).toEqual({
      'exec.outcome': 'exit',
      'exec.exitCode': 2,
      'exec.durationMs': 42,
      'exec.program': 'curl',
    })
    expect(JSON.stringify(detail)).not.toContain('sk-live-1234')
  })

  it('reports the subcommand of a tool that takes one', () => {
    expect(
      bashSpanDetailOf({
        command: 'bun test --filter dispatch',
        outcome: EBashExecOutcome.Ok,
        exitCode: 0,
        durationMs: 900,
      })['exec.program'],
    ).toBe('bun test')
  })

  it('leaves the exit code out when the command never gave one', () => {
    expect(
      bashSpanDetailOf({
        command: 'sleep 30',
        outcome: EBashExecOutcome.Timeout,
        durationMs: 400,
      }),
    ).toEqual({ 'exec.outcome': 'timeout', 'exec.durationMs': 400, 'exec.program': 'sleep' })
  })
})

describe('bashExecOutcomeOf', () => {
  it('reports out of memory ahead of a timeout that landed with it', () => {
    expect(bashExecOutcomeOf({ oomKilled: true, timedOut: true, exitCode: 137 })).toBe(
      EBashExecOutcome.Oom,
    )
  })

  it('reports a timeout ahead of the exit code the kill produced', () => {
    expect(bashExecOutcomeOf({ oomKilled: false, timedOut: true, exitCode: 0 })).toBe(
      EBashExecOutcome.Timeout,
    )
  })

  it('reports ok for zero and exit for anything else', () => {
    expect(bashExecOutcomeOf({ oomKilled: false, timedOut: false, exitCode: 0 })).toBe(
      EBashExecOutcome.Ok,
    )
    expect(bashExecOutcomeOf({ oomKilled: false, timedOut: false, exitCode: 3 })).toBe(
      EBashExecOutcome.Exit,
    )
  })
})
