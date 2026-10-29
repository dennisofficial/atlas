import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
} from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { contextRowsOf, findContextNode, type ContextRow } from './details-model'
import { CONTEXT_TREE } from './details-fixtures'
import { DetailsSection, RowButton } from './section'

function Row(props: { row: ContextRow; onActivate: (row: ContextRow) => void }) {
  const { row } = props
  const Chevron = row.open ? ChevronDownIcon : ChevronRightIcon
  const Icon = row.isDirectory ? FolderIcon : FileIcon
  return (
    <RowButton onClick={() => props.onActivate(row)}>
      <span style={{ width: `${row.depth * 12}px` }} className="shrink-0" aria-hidden />
      {row.isDirectory ? (
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{row.name}</span>
    </RowButton>
  )
}

export function ContextSection() {
  const [open, setOpen] = useState<string[]>(['plans'])
  const [viewing, setViewing] = useState<string | null>(null)
  const rows = contextRowsOf({ nodes: CONTEXT_TREE, open })

  const handleActivate = (row: ContextRow) => {
    if (!row.isDirectory) return setViewing(row.path)
    setOpen((held) =>
      held.includes(row.path) ? held.filter((path) => path !== row.path) : [...held, row.path],
    )
  }

  const file = viewing === null ? undefined : findContextNode(CONTEXT_TREE, viewing)
  if (viewing !== null && file) {
    return (
      <DetailsSection title="Context">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setViewing(null)}>
          <ArrowLeftIcon />
          Back
        </Button>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="truncate font-mono text-xs text-muted-foreground" title={file.path}>
            {file.path}
          </p>
          <pre className="overflow-auto font-mono text-xs whitespace-pre-wrap">{file.content}</pre>
        </div>
      </DetailsSection>
    )
  }

  return (
    <DetailsSection title="Context" count={rows.length}>
      {rows.map((row) => (
        <Row key={row.path} row={row} onActivate={handleActivate} />
      ))}
    </DetailsSection>
  )
}
