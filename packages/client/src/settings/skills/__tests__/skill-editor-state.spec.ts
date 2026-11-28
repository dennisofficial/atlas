import { describe, expect, it } from 'bun:test'
import {
  ESkillEditorAction,
  initialSkillEditorState,
  skillDetailIsReadOnly,
  skillEditorReducer,
} from '../skill-editor-state'

describe('skill editor state', () => {
  it('keeps the local draft across a conflict and uses the new revision for retry', () => {
    const state = initialSkillEditorState({ text: 'original', revision: 1 })
    const edited = skillEditorReducer(state, { type: ESkillEditorAction.Edit, text: 'mine' })
    const conflict = skillEditorReducer(edited, {
      type: ESkillEditorAction.Conflict,
      theirs: 'theirs',
      revision: 2,
    })
    expect(conflict).toEqual({
      saved: { text: 'theirs', revision: 2 },
      draft: 'mine',
      conflict: 'theirs',
    })
    expect(skillEditorReducer(conflict, { type: ESkillEditorAction.Discard })).toEqual({
      saved: { text: 'theirs', revision: 2 },
      draft: 'theirs',
      conflict: null,
    })
    expect(
      skillEditorReducer(conflict, { type: ESkillEditorAction.Saved, text: 'mine', revision: 3 }),
    ).toEqual({ saved: { text: 'mine', revision: 3 }, draft: 'mine', conflict: null })
  })
  it('makes only revision-zero built-in files read-only', () => {
    expect(skillDetailIsReadOnly([])).toBe(false)
    expect(skillDetailIsReadOnly([{ revision: 0 }, { revision: 0 }])).toBe(true)
    expect(skillDetailIsReadOnly([{ revision: 1 }])).toBe(false)
  })
})
