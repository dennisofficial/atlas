'use client'

import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'

import { contextIndentOf, EContextStatus, type ContextRow } from '../../data/context-tree-model'
import type { ContextFiles } from '../../data/use-context-files'
import { useThreadPanel } from '../thread-panel-context'
import { DetailsSection, Muted, RowButton } from './section'

const STATUS_COPY: Record<Exclude<EContextStatus, EContextStatus.Ready>, string> = {
  [EContextStatus.Loading]: 'Reading context…',
  [EContextStatus.Unavailable]: 'Context unavailable',
  [EContextStatus.Empty]: 'No context files yet',
}

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
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
    </RowButton>
  )
}

export function ContextSection(props: { files: ContextFiles }) {
  const { files } = props
  const { contextPath, openContextFile } = useThreadPanel()

  const handleActivate = (row: ContextRow) => {
    if (row.isDirectory) files.toggle(row)
    else openContextFile(row.path)
  }

  return (
    <DetailsSection title="Context" count={files.rows.length}>
      {files.status === EContextStatus.Ready ? (
        files.rows.map((row) => (
          <Row
            key={row.path}
            row={row}
            current={row.path === contextPath}
            onActivate={handleActivate}
          />
        ))
      ) : (
        <Muted>{STATUS_COPY[files.status]}</Muted>
      )}
    </DetailsSection>
  )
}
