import React from 'react'

import type { ShellSnapshot } from '@dltech/atlas-harness'

import type { SidebarCrewFold } from '../../../store/subagent-row'
import { plural } from '../../../store/tools/reading'
import { usePress } from '../../hooks/use-press'
import { shellNameLabel, shellReadout } from '../../shells-model'
import { glyph, theme } from '../../theme'
import type { Span } from '../spans'
import { Row, Section } from './row'

const markFor = (shell: ShellSnapshot) =>
  shell.awaitingInput
    ? { text: glyph.warning, fg: theme.warn }
    : { text: glyph.active, fg: theme.ok }

const valueFor = (args: { shell: ShellSnapshot; now: number }): readonly Span[] => [
  { text: shellReadout(args), fg: args.shell.awaitingInput ? theme.warn : theme.hint },
]

/**
 * What finished and left the panel, kept as one line rather than a heading of its own. The
 * reading names `/shells` because a finished shell is still whole — the row leaves the sidebar,
 * nothing leaves the registry or its scrollback.
 */
function RetiredLine(props: { fold: SidebarCrewFold; cells: number }): React.ReactNode {
  return (
    <Row
      label={`${plural(props.fold.hidden, 'more')} in /shells`}
      labelFg={theme.rule}
      cells={props.cells}
      mark={{ text: glyph.seen, fg: theme.rule }}
    />
  )
}

export function ShellsSection(props: {
  shells: readonly ShellSnapshot[]
  now: number
  cells: number
  fold?: SidebarCrewFold | undefined
  onOpen?: (shellId: string) => void
}): React.ReactNode {
  const press = usePress()
  if (props.shells.length === 0) return null

  const hidden = props.fold?.hidden ?? 0

  return (
    <Section label="Shells" count={`${props.shells.length}/${props.shells.length + hidden}`}>
      {props.shells.map((shell) => (
        <box
          key={shell.shellId}
          flexShrink={0}
          {...press(props.onOpen === undefined ? undefined : () => props.onOpen?.(shell.shellId))}
        >
          <Row
            label={shellNameLabel(shell)}
            labelFg={theme.hover}
            cells={props.cells}
            mark={markFor(shell)}
            value={valueFor({ shell, now: props.now })}
          />
        </box>
      ))}
      {props.fold === undefined || props.fold.hidden === 0 ? null : (
        <RetiredLine fold={props.fold} cells={props.cells} />
      )}
    </Section>
  )
}
