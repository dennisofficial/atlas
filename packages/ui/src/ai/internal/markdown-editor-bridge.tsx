import { createContext, useContext, useEffect } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import {
  addComposerChild$,
  addTopAreaChild$,
  contentEditableRef$,
  markdownProcessingError$,
  realmPlugin,
  useCellValue,
  type ViewMode,
  viewMode$,
} from '@mdxeditor/editor'

import { EMarkdownEditorVariant } from './markdown-editor-variant'

export type EditorFieldState = {
  id: string | undefined
  invalid: boolean
  variant: EMarkdownEditorVariant
}

export const EditorFieldContext = createContext<EditorFieldState>({
  id: undefined,
  invalid: false,
  variant: EMarkdownEditorVariant.Field,
})

const NOTICE_CLASSES: Record<EMarkdownEditorVariant, string> = {
  [EMarkdownEditorVariant.Field]:
    'flex items-start gap-2 border-b border-border bg-warning/10 px-3 py-2 text-xs text-foreground',
  [EMarkdownEditorVariant.Document]:
    'mt-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-foreground',
}

type BridgeParams = { viewModeRef: { current: ViewMode } }

function ContentEditableAttributes() {
  const wrapper = useCellValue(contentEditableRef$)
  const { id, invalid } = useContext(EditorFieldContext)

  useEffect(() => {
    const editable = wrapper?.current.querySelector('[contenteditable]')
    if (!editable) return
    if (id) editable.id = id
    editable.setAttribute('aria-invalid', String(invalid))
  }, [wrapper, id, invalid])

  return null
}

function ParseFallbackNotice() {
  const failure = useCellValue(markdownProcessingError$)
  const { variant } = useContext(EditorFieldContext)
  if (!failure) return null
  return (
    <div role="status" className={NOTICE_CLASSES[variant]}>
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>The visual editor can't read some of this syntax, so it opened in Source mode.</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{failure.error}</span>
      </div>
    </div>
  )
}

export const markdownEditorBridge = realmPlugin<BridgeParams>({
  init(realm, params) {
    realm.pubIn({
      [addTopAreaChild$]: ParseFallbackNotice,
      [addComposerChild$]: ContentEditableAttributes,
    })
    realm.sub(markdownProcessingError$, (error) => {
      if (error) realm.pub(viewMode$, 'source')
    })
    realm.sub(viewMode$, (mode) => {
      if (params) params.viewModeRef.current = mode
    })
  },
})
