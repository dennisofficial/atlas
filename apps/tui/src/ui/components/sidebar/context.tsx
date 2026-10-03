import React from 'react'
import type { DirectoryEntry } from '@dltech/atlas-core'

import { useClickRegion } from '../../hooks/use-click-region'
import { glyph, theme } from '../../theme'
import { Row, Section } from './row'

function ContextRow(props: { label: string; directory: boolean; cells: number; onOpen: () => void }) {
  const region = useClickRegion(props.onOpen)
  return (
    <box flexShrink={0} {...region.handlers} backgroundColor={region.wash.bg ?? theme.panelBg}>
      <Row label={props.label} labelFg={theme.hover} cells={props.cells}
        mark={{ text: props.directory ? glyph.file : glyph.document, fg: theme.hint }} />
    </box>
  )
}

export type ContextSectionProps = {
  entries: readonly DirectoryEntry[]
  loading: boolean
  cells: number
  directory?: string
  error?: string | null
  onUp?: () => void
  onOpen: (name: string) => void
}

export function ContextSection(props: ContextSectionProps): React.ReactNode {
  return (
    <Section label={props.directory ? `Context / ${props.directory}` : 'Context'} count={`${props.entries.length}`}>
      {!props.directory || props.onUp === undefined ? null : (
        <ContextRow label=".. / back" directory cells={props.cells} onOpen={props.onUp} />
      )}
      {props.error ? <text fg={theme.warn} width={props.cells}>{props.error}</text> : null}
      {props.entries.length === 0 ? <text fg={theme.hint} width={props.cells}>
        {props.loading ? 'Reading context…' : 'No context files yet'}
      </text> : null}
      {props.entries.map((entry) => (
        <ContextRow key={entry.name} label={entry.isDirectory ? `${entry.name}/` : entry.name}
          directory={entry.isDirectory} cells={props.cells} onOpen={() => props.onOpen(entry.name)} />
      ))}
    </Section>
  )
}
