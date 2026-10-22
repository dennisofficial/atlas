import { describe, expect, it } from 'bun:test'

import { EContextSlot } from '../slot'
import { contextBlock, wrapInSystemReminder } from '../render'

describe('wrapInSystemReminder', () => {
  it('fences the text so the model can tell it apart from what a human typed', () => {
    expect(wrapInSystemReminder('be careful')).toBe(
      '<system-context>\nbe careful\n</system-context>',
    )
  })
})

describe('contextBlock provenance', () => {
  const blockFor = (args: { slot: EContextSlot; key: string }): string =>
    contextBlock({ slot: args.slot, key: args.key, content: '# rules' })

  it('says a checked-in project file is checked in', () => {
    expect(blockFor({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md' })).toContain(
      'Contents of /repo/CLAUDE.md (project instructions, checked into the codebase):',
    )
  })

  it('says a local project file is not checked in', () => {
    expect(
      blockFor({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.local.md' }),
    ).toContain("Contents of /repo/CLAUDE.local.md (the user's private project instructions, not checked in):")
  })

  it('treats an AGENTS.local.md the same way as a CLAUDE.local.md', () => {
    expect(
      blockFor({ slot: EContextSlot.ProjectInstructions, key: '/repo/AGENTS.local.md' }),
    ).toContain('not checked in')
  })

  it('does not mistake a file merely containing the word local for a local file', () => {
    expect(blockFor({ slot: EContextSlot.ProjectInstructions, key: '/repo/local/CLAUDE.md' })).toContain(
      'checked into the codebase',
    )
  })

  it('marks a user file as global and private', () => {
    expect(blockFor({ slot: EContextSlot.UserInstructions, key: '/home/dev/.claude/CLAUDE.md' })).toContain(
      "Contents of /home/dev/.claude/CLAUDE.md (the user's private global instructions for all projects):",
    )
  })

  it('explains why a nested file appeared, since the model did not ask for it', () => {
    const block = blockFor({ slot: EContextSlot.NestedInstructions, key: '/repo/apps/tui/CLAUDE.md' })

    expect(block).toContain('Contents of /repo/apps/tui/CLAUDE.md')
    expect(block).toContain('a tool touched a file beneath it')
  })

  it('wraps every block in a reserved system-context envelope naming its source', () => {
    const block = blockFor({ slot: EContextSlot.ProjectInstructions, key: '/repo/CLAUDE.md' })

    expect(block.startsWith('<system-context source="project-instructions">\n')).toBe(true)
    expect(block.endsWith('\n</system-context>')).toBe(true)
    expect(block).toContain('# rules')
  })

  it('attributes a listing without a path to the harness', () => {
    const block = contextBlock({
      slot: EContextSlot.SkillListing,
      key: 'skills',
      content: 'The following skills are available',
    })

    expect(block).toContain('Skills available to load:')
    expect(block.startsWith('<system-context source="skill-listing">\n')).toBe(true)
  })

  it('attributes an unrecognised slot to the harness rather than leaving it bare', () => {
    const block = contextBlock({ slot: 'something-new', key: '/repo/x', content: 'body' })

    expect(block).toContain('(source: something-new)')
    expect(block).toContain('The operator did not write this')
  })
})
