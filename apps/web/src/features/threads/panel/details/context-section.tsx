'use client'

import { useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  ArrowLeftIcon,
} from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

import { EContextStatus, type ContextRow } from '../../data/context-tree-model'
import type { ContextFiles } from '../../data/use-context-files'
import { useThreadPanel } from '../thread-panel-context'
import { ContextFileViewer } from './context-file-viewer'
import { DetailsSection, Muted, RowButton } from './section'

const STATUS_COPY: Record<Exclude<EContextStatus, EContextStatus.Ready>, string> = {
  [EContextStatus.Loading]: 'Reading context…',
  [EContextStatus.Unavailable]: 'Context unavailable',
  [EContextStatus.Empty]: 'No context files yet',
}

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
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
    </RowButton>
  )
}

export function ContextSection(props: { files: ContextFiles }) {
  const { files } = props
  const { channel } = useThreadPanel()
  const [viewing, setViewing] = useState<string | null>(null)

  const handleActivate = (row: ContextRow) => {
    if (row.isDirectory) files.toggle(row)
    else setViewing(row.path)
  }

  if (viewing !== null && channel !== null) {
    return (
      <DetailsSection title="Context">
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setViewing(null)}>
          <ArrowLeftIcon />
          Back
        </Button>
        <ContextFileViewer key={viewing} path={viewing} channel={channel} />
      </DetailsSection>
    )
  }

  return (
    <DetailsSection title="Context" count={files.rows.length}>
      {files.status === EContextStatus.Ready ? (
        files.rows.map((row) => <Row key={row.path} row={row} onActivate={handleActivate} />)
      ) : (
        <Muted>{STATUS_COPY[files.status]}</Muted>
      )}
    </DetailsSection>
  )
}
