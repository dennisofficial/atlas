import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import { contextIndentOf, contextRowsOf, type ContextRow } from './details-model'
import { CONTEXT_TREE } from './details-fixtures'
import { DetailsSection } from './section'

function Row(props: { row: ContextRow; current: boolean; onActivate: (row: ContextRow) => void }) {
  const { row } = props
  const Icon = row.isDirectory ? (row.open ? ChevronDownIcon : ChevronRightIcon) : FileIcon
  const indent = contextIndentOf(row.depth)
  return (
    <DetailRow
      current={props.current}
      indent={indent}
      icon={<Icon aria-hidden className="size-3.5" />}
      label={row.name}
      onClick={() => props.onActivate(row)}
    />
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
