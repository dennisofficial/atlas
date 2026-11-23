'use client'

import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'

import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'

import { contextTreeOf, useContextMirror, useContextMirrorRefresh } from '../../data/context-files'
import { useSessionPaneValue } from '../pane-value'
import { EmptyLine, Row, SectionHead } from './rows'

const INDENT_PER_DEPTH = 12

type MirrorFile = { path: string }

function ContextDirectory(props: {
  files: readonly MirrorFile[]
  directory: string
  depth: number
}) {
  const openContextFile = useOptionalThreadPanel()?.openContextFile
  const [open, setOpen] = useState<readonly string[]>([])
  const entries = contextTreeOf({ files: props.files, directory: props.directory })
  const handleToggle = (directory: string) =>
    setOpen((held) =>
      held.includes(directory) ? held.filter((path) => path !== directory) : [...held, directory],
    )

  return (
    <>
      {entries.map((entry) => {
        const path = props.directory === '' ? entry.name : `${props.directory}/${entry.name}`
        const expanded = open.includes(path)
        const Icon = entry.isDirectory ? (expanded ? ChevronDownIcon : ChevronRightIcon) : FileIcon
        return (
          <div key={path} style={{ paddingLeft: props.depth * INDENT_PER_DEPTH }}>
            <Row
              leading={<Icon aria-hidden className="size-3.5" />}
              title={<span className="font-mono">{entry.name}</span>}
              label={entry.isDirectory ? `Expand ${entry.name}` : `Open ${entry.name}`}
              onSelect={
                entry.isDirectory
                  ? () => handleToggle(path)
                  : openContextFile === undefined
                    ? undefined
                    : () => openContextFile(path)
              }
            />
            {entry.isDirectory && expanded ? (
              <ContextDirectory files={props.files} directory={path} depth={props.depth + 1} />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function SessionContextSection() {
  const { sessionId, contextChanged, turnEnds } = useSessionPaneValue()
  const mirror = useContextMirror(sessionId)
  useContextMirrorRefresh({ sessionId, changed: contextChanged, turnEnds })

  return (
    <section data-session-context aria-label="Context" className="flex flex-col">
      <SectionHead title="Context" />
      <ContextMirrorBody
        state={mirror.isPending ? 'loading' : mirror.isError ? 'failed' : 'ready'}
        files={mirror.data?.files ?? []}
      />
    </section>
  )
}

export function ContextMirrorBody(props: {
  state: 'loading' | 'failed' | 'ready'
  files: readonly MirrorFile[]
}) {
  if (props.state === 'loading') return <EmptyLine>Reading context…</EmptyLine>
  if (props.state === 'failed') return <EmptyLine>Context unavailable</EmptyLine>
  if (props.files.length === 0) return <EmptyLine>No context files yet</EmptyLine>
  return <ContextDirectory files={props.files} directory="" depth={0} />
}
