import { describe, expect, it } from 'bun:test'
import {
  catalogueForSurface,
  composeCommands,
  ECommandRunsIn,
  ECommandSource,
  entryOf,
  EInvocation,
  ESurface,
  parseInvocation,
  SURFACE_PROFILES,
} from '@dltech/atlas-commands'

import { nativeCommands } from '../..'
import { REFUSAL_RESUME_TEXT, resume, resumeArgs } from '../spec'

const registry = composeCommands(nativeCommands)

const parse = (text: string) => parseInvocation({ text, commands: registry, skills: [] })

describe('the resume command', () => {
  it('runs in the host and owns one inbox kind', () => {
    expect(resume.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(resume.inboxKind).toBe('command:resume')
    expect(registry.byInboxKind.get('command:resume')).toBe(resume)
  })

  it('takes no arguments by default', () => {
    expect(parse('/resume')).toEqual({
      kind: EInvocation.Command,
      command: resume,
      args: {},
      argumentText: '',
    })
  })

  it('takes an agent id', () => {
    expect(parse('/resume --agent child-1')).toEqual({
      kind: EInvocation.Command,
      command: resume,
      args: { agentId: 'child-1' },
      argumentText: '--agent child-1',
    })
  })

  it('refuses words after the command', () => {
    expect(parse('/resume ship it')).toEqual({
      kind: EInvocation.Refused,
      name: 'resume',
      reason: REFUSAL_RESUME_TEXT,
    })
  })

  it('refuses an unknown flag', () => {
    expect(parse('/resume --nope')).toEqual({
      kind: EInvocation.Refused,
      name: 'resume',
      reason: REFUSAL_RESUME_TEXT,
    })
  })

  it('refuses an agent flag with no id', () => {
    expect(resumeArgs.safeParse({ agentId: '' }).success).toBe(false)
    expect(parse('/resume --agent').kind).toBe(EInvocation.Refused)
  })

  it('appears in the catalogue for web, mac, mobile and tui', () => {
    const entries = nativeCommands.map((command) =>
      entryOf({ command, source: ECommandSource.Builtin }),
    )
    for (const surface of Object.values(ESurface)) {
      const names = catalogueForSurface({ entries, surface }).map((entry) => entry.name)
      expect(names).toContain('resume')
    }
  })

  it('is neither hidden nor picked anywhere', () => {
    for (const profile of Object.values(SURFACE_PROFILES)) {
      expect(profile.hides.map((entry) => entry.name)).not.toContain('resume')
      expect(profile.picks.map((entry) => entry.name)).not.toContain('resume')
    }
  })
})
