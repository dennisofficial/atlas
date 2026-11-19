'use client'

import { useMemo, useState } from 'react'
import { FolderTreeIcon, SearchIcon } from 'lucide-react'

import { FileSearchResults } from '@dltech/atlas-ui/ai/file-search-results'
import { EFileChange, FileTree } from '@dltech/atlas-ui/ai/file-tree'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'

import { api, cloudCall } from '@/lib/api-client'
import { nodesOf } from '@/features/threads/data/file-tree-nodes'
import { pathWithin } from '@/features/threads/data/file-tree-source'
import { v2FileSource, type FileSource } from '@/features/threads/data/file-source'
import { EFileSearchStatus, useFileSearch } from '@/features/threads/data/use-file-search'
import { EFileTreeStatus, useFileTree } from '@/features/threads/data/use-file-tree'
import { useWorkspaceFile } from '@/features/threads/data/use-workspace-file'
import { FileBody } from '@/features/threads/context-viewer/file-viewer'
import { lineMarksOf } from '@/features/threads/data/line-marks'
import { usePodHold } from '../data/use-pod-hold'
import { usePodWake } from '../data/use-pod-wake'
import { podAttached } from '../data/pod-attachment'
import { useSessionPaneValue } from '../panel/pane-value'
import { PodDisconnected } from '../panel/pod-disconnected'
import { recallSelectedFile, rememberSelectedFile } from './files-memory'

const requestWake = (sessionId: string) => cloudCall(api.sessions.wake.mutate({ sessionId }))

function FilesBody(props: { sessionId: string; source: FileSource; podAwake: boolean }) {
  const { source } = props
  const [selected, setSelectedState] = useState(() => recallSelectedFile(props.sessionId))
  const [query, setQuery] = useState('')
  const {
    view: tree,
    open,
    setOpen,
  } = useFileTree({
    source,
    podAwake: props.podAwake,
    threadId: props.sessionId,
  })
  const search = useFileSearch({ source, query })
  const loaded = useWorkspaceFile({
    source,
    path: selected ?? '',
    podAwake: props.podAwake && selected !== undefined,
  })
  const changes = useMemo(() => {
    const map = new Map<string, EFileChange>()
    if (tree.status !== EFileTreeStatus.Ready) return map
    for (const [directory, entries] of tree.listings) {
      for (const entry of entries) {
        if (entry.changed === true)
          map.set(pathWithin({ directory, name: entry.name }), EFileChange.Modified)
      }
    }
    return map
  }, [tree])
  const nodes = useMemo(
    () =>
      tree.status === EFileTreeStatus.Ready
        ? nodesOf({ listings: tree.listings, changes, ignored: new Set() })
        : [],
    [tree, changes],
  )
  const handleSelect = (path: string) => {
    setSelectedState(path)
    rememberSelectedFile({ sessionId: props.sessionId, path })
  }
  const handleOpenChange = (change: { path: string; open: boolean }) =>
    setOpen({ directory: change.path, open: change.open })
  const handleQueryChange = (event: { target: { value: string } }) => setQuery(event.target.value)

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          aria-label="Search files by name"
          placeholder="Search files"
          value={query}
          onChange={handleQueryChange}
        />
      </InputGroup>
      <div className="min-h-0 flex-1 overflow-auto">
        {query.trim() === '' ? (
          <FileTree
            nodes={nodes}
            selected={selected}
            onSelect={handleSelect}
            open={open}
            onOpenChange={handleOpenChange}
          />
        ) : search.status === EFileSearchStatus.Ready ? (
          <FileSearchResults
            hits={search.paths}
            active={0}
            listId="v2-files-search"
            onSelect={handleSelect}
            onActiveChange={() => undefined}
          />
        ) : null}
      </div>
      {selected !== undefined ? (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border pt-2">
          <FileBody loaded={loaded} path={selected} marks={lineMarksOf([])} rendered={null} />
        </div>
      ) : null}
    </div>
  )
}

export function FilesTab(props: { sourceOf?: (sessionId: string) => FileSource } = {}) {
  const { sessionId, status } = useSessionPaneValue()
  const sourceOf = props.sourceOf ?? ((id: string) => v2FileSource({ sessionId: id }))
  const source = useMemo(() => sourceOf(sessionId), [sourceOf, sessionId])
  const attached = podAttached(status)
  usePodHold({ sessionId, active: attached })
  const { state, wakePod } = usePodWake({
    sessionId,
    live: attached,
    wake: () => requestWake(sessionId).then(() => undefined),
  })
  if (!attached) return <PodDisconnected tab="Files" state={state} onWake={wakePod} />
  return <FilesBody sessionId={sessionId} source={source} podAwake={attached} />
}

export const FILES_TAB_ICON = <FolderTreeIcon />
