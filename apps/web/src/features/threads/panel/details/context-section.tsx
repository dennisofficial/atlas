'use client'

import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import { contextIndentOf, EContextStatus, type ContextRow } from '../../data/context-tree-model'
import type { ContextFiles } from '../../data/use-context-files'
import { useThreadPanel } from '../thread-panel-context'
import { DetailsSection, Muted } from './section'

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
    <DetailRow
      current={props.current}
      indent={indent}
      icon={<Icon aria-hidden className="size-3.5" />}
      label={row.name}
      onClick={() => props.onActivate(row)}
    />
  )
}

export function ContextSection(props: { files: ContextFiles }) {
  const { files } = props
  const { contextPath, toggleContextFile } = useThreadPanel()

  const handleActivate = (row: ContextRow) => {
    if (row.isDirectory) files.toggle(row)
    else toggleContextFile(row.path)
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
