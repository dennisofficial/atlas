'use client'

import { useSessionPaneValue } from '../pane-value'
import { Dot, FoldedRows, Row, SectionHead } from './rows'

const lastLineOf = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return lines.at(-1)
}

export function SessionShellsSection() {
  const { view, shellTails } = useSessionPaneValue()
  if (view.shells.running === 0) return null
  return (
    <section data-session-shells aria-label="Shells" className="flex flex-col">
      <SectionHead title="Shells" count={view.shells.running} />
      <FoldedRows
        rows={view.shells.rows}
        render={(row) => (
          <Row
            key={row.shellId}
            leading={<Dot className={view.shells.awaitingInput ? 'bg-warning' : 'bg-success'} />}
            title={<span className="font-mono">{row.name}</span>}
            meta={lastLineOf(shellTails[row.shellId])}
          />
        )}
      />
    </section>
  )
}
