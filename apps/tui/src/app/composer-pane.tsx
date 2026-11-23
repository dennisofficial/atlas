import React from 'react'

import { Composer, composerRows, composerTone, type HighlightSpan } from '../ui/components/composer'
import { FileMenu } from '../ui/components/file-menu'
import type { FileMenuState } from '../ui/file-menu-model'
import type { DraftControls } from '../ui/hooks/use-draft'

const STEER_PLACEHOLDER = 'Steer the turn'

export function ComposerPane(props: {
  draft: DraftControls
  fileMenu: FileMenuState | null
  highlights: readonly HighlightSpan[]
  width: number
  height: number
  working: boolean
  interrupting: boolean
  focused: boolean
  onCursorMoved: () => void
}): React.ReactNode {
  const tone = composerTone({ working: props.working, interrupting: props.interrupting })

  return (
    <box flexDirection="column" flexShrink={0} width={props.width}>
      {props.fileMenu === null ? null : <FileMenu state={props.fileMenu} width={props.width} />}
      <Composer
        draft={props.draft}
        width={props.width}
        tone={tone}
        {...(props.working ? { placeholder: STEER_PLACEHOLDER } : {})}
        maxRows={composerRows(props.height)}
        focused={props.focused}
        highlights={props.highlights}
        onCursorMoved={props.onCursorMoved}
      />
    </box>
  )
}
