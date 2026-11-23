import { describe, expect, it } from 'bun:test'
import {
  composeCommands,
  ECommandGroup,
  ECommandRunsIn,
  EInvocation,
  parseInvocation,
} from '@dltech/atlas-commands'

import { cancelResize, cancelResizeArgs } from '../spec'

const registry = composeCommands([cancelResize])

describe('cancel-resize spec', () => {
  it('runs in the control plane with no arguments and no inbox entry', () => {
    expect(cancelResize.spec.name).toBe('cancel-resize')
    expect(cancelResize.spec.group).toBe(ECommandGroup.Session)
    expect(cancelResize.spec.runsIn).toBe(ECommandRunsIn.Control)
    expect(cancelResize.spec.fromText).toBeUndefined()
    expect(cancelResize.inboxKind).toBe('command:cancel-resize')
  })

  it('accepts only an empty argument object', () => {
    expect(cancelResizeArgs.parse({})).toEqual({})
    expect(cancelResizeArgs.safeParse({ vcpus: 4 }).success).toBe(false)
  })

  it('parses an empty slash command', () => {
    expect(parseInvocation({ text: '/cancel-resize', commands: registry, skills: [] })).toEqual({
      kind: EInvocation.Command,
      command: cancelResize,
      args: {},
      argumentText: '',
    })
  })

  it('refuses argument text', () => {
    expect(parseInvocation({ text: '/cancel-resize now', commands: registry, skills: [] })).toEqual(
      {
        kind: EInvocation.Refused,
        name: 'cancel-resize',
        reason: '/cancel-resize takes no arguments',
      },
    )
  })
})
