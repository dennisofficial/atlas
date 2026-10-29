import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'

import { contextIndentOf, contextRowsOf, type ContextRow } from './details-model'
import { CONTEXT_TREE } from './details-fixtures'
import { DetailsSection, RowButton } from './section'

function Row(props: { row: ContextRow; current: boolean; onActivate: (row: ContextRow) => void }) {
  const { row } = props
  const Icon = row.isDirectory ? (row.open ? ChevronDownIcon : ChevronRightIcon) : FileIcon
  const indent = contextIndentOf(row.depth)
  return (
    <RowButton current={props.current} onClick={() => props.onActivate(row)}>
      {indent === 0 ? null : (
        <span style={{ width: `${indent}px` }} className="shrink-0" aria-hidden />
      )}
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{row.name}</span>
    </RowButton>
  )
}

export function ContextSection(props: { current?: string; onOpen: (path: string) => void }) {
  const [open, setOpen] = useState<string[]>(['plans'])
  const rows = contextRowsOf({ nodes: CONTEXT_TREE, open })

  const handleActivate = (row: ContextRow) => {
    if (!row.isDirectory) return props.onOpen(row.path)
    setOpen((held) =>
      held.includes(row.path) ? held.filter((path) => path !== row.path) : [...held, row.path],
    )
  }

  return (
    <DetailsSection title="Context" count={rows.length}>
      {rows.map((row) => (
        <Row
          key={row.path}
          row={row}
          current={row.path === props.current}
          onActivate={handleActivate}
        />
      ))}
    </DetailsSection>
  )
}
