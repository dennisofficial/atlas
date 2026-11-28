'use client'

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'

import { FileTypeIcon } from '@dltech/atlas-ui/ai/file-type-icon'

import { contextTreeOf, useContextMirror, useContextMirrorRefresh } from '../../data/context-files'
import { recallContextOpen, rememberContextOpen } from '../pane-memory'
import { useSessionPaneValue } from '../pane-value'
import { EmptyLine, Row, SectionHead } from './rows'
import { Reveal, RevealRows } from './reveal'

const INDENT_PER_DEPTH = 12

type MirrorFile = { path: string }

function ContextDirectory(props: {
  files: readonly MirrorFile[]
  directory: string
  depth: number
  open: readonly string[]
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  const entries = contextTreeOf({ files: props.files, directory: props.directory })

  return (
    <RevealRows
      rows={entries}
      rowKey={(entry) => entry.name}
      render={(entry) => {
        const path = props.directory === '' ? entry.name : `${props.directory}/${entry.name}`
        const expanded = props.open.includes(path)
        const Icon = expanded ? ChevronDownIcon : ChevronRightIcon
        return (
          <div key={path} style={{ paddingLeft: props.depth * INDENT_PER_DEPTH }}>
            <Row
              leading={
                entry.isDirectory ? (
                  <Icon aria-hidden className="size-3.5" />
                ) : (
                  <FileTypeIcon name={entry.name} className="size-3.5" />
                )
              }
              title={entry.name}
              label={entry.isDirectory ? `Expand ${entry.name}` : `Open ${entry.name}`}
              onSelect={
                entry.isDirectory ? () => props.onToggle(path) : () => props.onOpenFile(path)
              }
            />
            <Reveal open={entry.isDirectory && expanded}>
              <ContextDirectory
                files={props.files}
                directory={path}
                depth={props.depth + 1}
                open={props.open}
                onToggle={props.onToggle}
                onOpenFile={props.onOpenFile}
              />
            </Reveal>
          </div>
        )
      }}
    />
  )
}

export function SessionContextSection(props: { onOpenFile: (path: string) => void }) {
  const { sessionId, contextChanged, turnEnds } = useSessionPaneValue()
  const mirror = useContextMirror(sessionId)
  useContextMirrorRefresh({ sessionId, changed: contextChanged, turnEnds })
  const [open, setOpen] = useState<readonly string[]>(() => recallContextOpen(sessionId))
  const handleToggle = (path: string) => {
    const next = open.includes(path) ? open.filter((held) => held !== path) : [...open, path]
    setOpen(next)
    rememberContextOpen({ sessionId, open: next })
  }

  return (
    <Reveal
      open={mirror.isError || (!mirror.isPending && (mirror.data?.files.length ?? 0) > 0)}
      section
    >
      <section data-session-context aria-label="Context" className="flex flex-col">
        <SectionHead title="Context" />
        <ContextMirrorBody
          state={mirror.isPending ? 'loading' : mirror.isError ? 'failed' : 'ready'}
          files={mirror.data?.files ?? []}
          open={open}
          onToggle={handleToggle}
          onOpenFile={props.onOpenFile}
        />
      </section>
    </Reveal>
  )
}

export function ContextMirrorBody(props: {
  state: 'loading' | 'failed' | 'ready'
  files: readonly MirrorFile[]
  open: readonly string[]
  onToggle: (path: string) => void
  onOpenFile: (path: string) => void
}) {
  if (props.state === 'loading') return null
  if (props.state === 'failed') return <EmptyLine>Context unavailable</EmptyLine>
  if (props.files.length === 0) return null
  return (
    <ContextDirectory
      files={props.files}
      directory=""
      depth={0}
      open={props.open}
      onToggle={props.onToggle}
      onOpenFile={props.onOpenFile}
    />
  )
}
