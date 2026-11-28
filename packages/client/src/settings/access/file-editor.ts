export type AccessFileEditorState = {
  loaded: boolean
  contents: string
  originalContents: string
  modeText: string
  originalModeText: string
}

export const accessFileEditorOf = ({
  editing,
  modeText,
}: {
  editing: boolean
  modeText: string
}): AccessFileEditorState => ({
  loaded: !editing,
  contents: '',
  originalContents: '',
  modeText,
  originalModeText: modeText,
})

export const loadAccessFileEditor = ({
  state,
  contents,
}: {
  state: AccessFileEditorState
  contents: string
}): AccessFileEditorState =>
  state.loaded ? state : { ...state, loaded: true, contents, originalContents: contents }

export const accessFileEditorDirty = (state: AccessFileEditorState): boolean =>
  state.loaded &&
  (state.contents !== state.originalContents || state.modeText !== state.originalModeText)

export const clearAccessFileEditor = (state: AccessFileEditorState): AccessFileEditorState => ({
  ...state,
  loaded: false,
  contents: '',
  originalContents: '',
  modeText: state.originalModeText,
})
