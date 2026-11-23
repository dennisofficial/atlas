'use client'

import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, ChevronRightIcon, FileIcon } from 'lucide-react'
import { useState } from 'react'

import { useOptionalThreadPanel } from '@/features/threads/panel/thread-panel-context'

import { contextDirectoryKey, fetchContextDirectory } from '../../data/context-files'
import { podAttached } from '../../data/pod-attachment'
import { useSessionPaneValue } from '../pane-value'
import { EmptyLine, Row, SectionHead } from './rows'

const INDENT_PER_DEPTH = 12

function ContextDirectory(props: { sessionId: string; directory: string; depth: number }) {
  const openContextFile = useOptionalThreadPanel()?.openContextFile
  const [open, setOpen] = useState<readonly string[]>([])
  const query = useQuery({
    queryKey: contextDirectoryKey({ sessionId: props.sessionId, directory: props.directory }),
    queryFn: () =>
      fetchContextDirectory({ sessionId: props.sessionId, directory: props.directory }),
  })
  const handleToggle = (directory: string) =>
    setOpen((held) =>
      held.includes(directory) ? held.filter((path) => path !== directory) : [...held, directory],
    )

  if (query.isPending) return <EmptyLine>Reading context…</EmptyLine>
  if (query.isError) return <EmptyLine>Context unavailable</EmptyLine>
  if (query.data.length === 0 && props.directory === '')
    return <EmptyLine>No context files yet</EmptyLine>

  return (
    <>
      {query.data.map((entry) => {
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
              <ContextDirectory
                sessionId={props.sessionId}
                directory={path}
                depth={props.depth + 1}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function SessionContextSection() {
  const { sessionId, status } = useSessionPaneValue()
  if (!podAttached(status)) {
    return (
      <section data-session-context aria-label="Context" className="flex flex-col">
        <SectionHead title="Context" />
        <EmptyLine>Context unavailable while the pod sleeps</EmptyLine>
      </section>
    )
  }
  return (
    <section data-session-context aria-label="Context" className="flex flex-col">
      <SectionHead title="Context" />
      <ContextDirectory sessionId={sessionId} directory="" depth={0} />
    </section>
  )
}
