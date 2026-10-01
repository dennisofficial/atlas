import React from 'react'

import { Composer, composerRows, composerTone, type HighlightSpan } from '../ui/components/composer'
import { CommandMenu } from '../ui/components/command-menu'
import { FileMenu } from '../ui/components/file-menu'
import type { NamingState } from '../ui/components/naming-line'
import type { DraftControls } from '../ui/hooks/use-draft'
import { theme } from '../ui/theme'
import type { ComposerMenus } from './use-composer-menus'

const STEER_PLACEHOLDER = 'Steer the turn'

const SUBAGENT_PLACEHOLDER = 'Message this sub-agent'

const composerPlaceholder = (args: {
  addressingChild: boolean
  working: boolean
}): string | undefined => {
  if (args.addressingChild) return SUBAGENT_PLACEHOLDER
  return args.working ? STEER_PLACEHOLDER : undefined
}

export function WorkspaceComposer(props: {
  draft: DraftControls
  menus: Pick<ComposerMenus, 'command' | 'file' | 'cd'>
  width: number
  height: number
  welcome: boolean
  focused: boolean
  working: boolean
  interrupting: boolean
  addressingChild: boolean
  highlights: readonly HighlightSpan[]
  onCursorMoved: () => void
  agentName: string | null
  handle: string | null
  naming: NamingState | null
}): React.ReactNode {
  const { menus, width, naming } = props

  const tone = composerTone({ working: props.working, interrupting: props.interrupting })
  const placeholder = composerPlaceholder({
    addressingChild: props.addressingChild,
    working: props.working,
  })

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width={width}
      alignSelf={props.welcome ? 'center' : 'flex-start'}
    >
      {menus.command === null ? null : <CommandMenu state={menus.command} width={width} />}
      {menus.file === null ? null : <FileMenu state={menus.file} width={width} />}
      {menus.cd === null ? null : <FileMenu state={menus.cd} width={width} label=" Directories " />}
      <Composer
        draft={props.draft}
        width={width}
        tone={tone}
        {...(placeholder === undefined ? {} : { placeholder })}
        maxRows={composerRows(props.height)}
        focused={props.focused}
        highlights={props.highlights}
        onCursorMoved={props.onCursorMoved}
        {...(props.agentName === null
          ? props.handle === null
            ? {}
            : { title: props.handle }
          : { title: `@${props.agentName}`, accent: theme.court.external })}
        {...(naming === null ? {} : { naming })}
      />
    </box>
  )
}
