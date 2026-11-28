export type SkillTextDocument = { text: string; revision: number }
export type SkillEditorState = {
  saved: SkillTextDocument
  draft: string
  conflict: string | null
}

export enum ESkillEditorAction {
  Edit = 'edit',
  Saved = 'saved',
  Conflict = 'conflict',
  Discard = 'discard',
}

export type SkillEditorAction =
  | { type: ESkillEditorAction.Edit; text: string }
  | { type: ESkillEditorAction.Saved; text: string; revision: number }
  | { type: ESkillEditorAction.Conflict; theirs: string; revision: number }
  | { type: ESkillEditorAction.Discard }

export const initialSkillEditorState = (saved: SkillTextDocument): SkillEditorState => ({
  saved,
  draft: saved.text,
  conflict: null,
})

export const skillEditorReducer = (
  state: SkillEditorState,
  action: SkillEditorAction,
): SkillEditorState => {
  switch (action.type) {
    case ESkillEditorAction.Edit:
      return { ...state, draft: action.text }
    case ESkillEditorAction.Saved:
      return {
        saved: { text: action.text, revision: action.revision },
        draft: action.text,
        conflict: null,
      }
    case ESkillEditorAction.Conflict:
      return {
        ...state,
        saved: { text: action.theirs, revision: action.revision },
        conflict: action.theirs,
      }
    case ESkillEditorAction.Discard:
      return { ...state, draft: state.saved.text, conflict: null }
  }
}

export const skillDetailIsReadOnly = (metas: readonly { revision: number }[]): boolean =>
  metas.length > 0 && metas.every((meta) => meta.revision === 0)
