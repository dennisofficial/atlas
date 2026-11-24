import { describe, expect, it } from 'bun:test'

import { ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'

import { REFUSAL_SHELL_KILL_ID, shellKill, shellKillArgs } from '../commands'

const argsOf = (argumentText: string): TextArgs =>
  shellKill.spec.fromText?.(argumentText) ?? { ok: false, reason: 'no fromText' }

describe('the shell-kill command', () => {
  it('is a host command in the session group', () => {
    expect(shellKill.spec.name).toBe('shell-kill')
    expect(shellKill.spec.group).toBe(ECommandGroup.Session)
    expect(shellKill.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(shellKill.inboxKind).toBe('command:shell-kill')
  })

  it('reads the shell id', () => {
    expect(argsOf(' shell-1 ')).toEqual({ ok: true, args: { shellId: 'shell-1' } })
  })

  it('refuses a line with no id', () => {
    expect(argsOf('')).toEqual({ ok: false, reason: REFUSAL_SHELL_KILL_ID })
  })

  it('refuses a line with more than an id', () => {
    expect(argsOf('shell-1 now')).toEqual({ ok: false, reason: REFUSAL_SHELL_KILL_ID })
  })

  it('refuses an empty id in the payload', () => {
    expect(shellKillArgs.safeParse({ shellId: '' }).success).toBe(false)
  })
})
