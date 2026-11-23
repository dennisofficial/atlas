'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderTreeIcon, SearchIcon } from 'lucide-react'

import { FileSearchResults } from '@dltech/atlas-ui/ai/file-search-results'
import { EFileChange, FileTree } from '@dltech/atlas-ui/ai/file-tree'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'

import { EFilesRoot } from '@dltech/atlas-protocol'
import { api, cloudCall } from '@/lib/api-client'
import { nodesOf } from '@/features/threads/data/file-tree-nodes'
import { pathWithin } from '@/features/threads/data/file-tree-source'
import { v2FileSource, type FileSource } from '@/features/threads/data/file-source'
import { EFileSearchStatus, useFileSearch } from '@/features/threads/data/use-file-search'
import { EFileTreeStatus, useFileTree } from '@/features/threads/data/use-file-tree'
import { useWorkspaceFile } from '@/features/threads/data/use-workspace-file'
import { FileBody } from '@/features/threads/context-viewer/file-viewer'
import { lineMarksOf } from '@/features/threads/data/line-marks'
import { TabPlaceholder } from '@/features/threads/panel/tab-placeholder'
import { useCheckoutChoice } from '../checkouts/checkout-choice-context'
import { CheckoutSelect } from '../checkouts/checkout-select'
import { usePodHold } from '../data/use-pod-hold'
import { usePodWake } from '../data/use-pod-wake'
import { podAttached } from '../data/pod-attachment'
import { EPaneOpen, checkoutPathOf, contextPathOf } from '../panel/pane-open'
import { useSessionPaneValue } from '../panel/pane-value'
import { PodDisconnected } from '../panel/pod-disconnected'
import { ContextFileView } from './context-file-view'
import { recallSelectedFile, rememberSelectedFile } from './files-memory'

const requestWake = (sessionId: string) => cloudCall(api.sessions.wake.mutate({ sessionId }))

function Notice(args: { title: string; description: string }) {
  return (
    <TabPlaceholder
      icon={<FolderTreeIcon aria-hidden />}
      title={args.title}
      description={args.description}
    />
  )
}

function Loading() {
  return (
    <div className="flex h-full p-4">
      <p role="status" className="text-sm text-muted-foreground">
        Loading files…
      </p>
    </div>
  )
}

function FilesBody(props: {
  sessionId: string
  source: FileSource
  podAwake: boolean
  openPath: string | undefined
  onOpened: () => void
}) {
  const { source } = props
  const [selected, setSelectedState] = useState(
    () => props.openPath ?? recallSelectedFile(props.sessionId),
  )
  const [query, setQuery] = useState('')
  const { openPath, onOpened } = props
  useEffect(() => {
    if (openPath === undefined) return
    setSelectedState(openPath)
    rememberSelectedFile({ sessionId: props.sessionId, path: openPath })
    onOpened()
  }, [openPath, onOpened, props.sessionId])
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
      <CheckoutSelect />
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
          tree.status === EFileTreeStatus.Failed ? (
            <Notice title="Files unavailable" description={tree.message} />
          ) : (
            <FileTree
              nodes={nodes}
              selected={selected}
              onSelect={handleSelect}
              open={open}
              onOpenChange={handleOpenChange}
            />
          )
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

export function FilesTab(
  props: {
    sourceOf?: (args: {
      sessionId: string
      checkoutId?: string | undefined
      root?: EFilesRoot | undefined
    }) => FileSource
  } = {},
) {
  const { sessionId, status, openRequest, consumeOpenRequest } = useSessionPaneValue()
  const { changes, options, selectedId, select } = useCheckoutChoice()
  const [openPath, setOpenPath] = useState<string | undefined>(undefined)
  const [contextPath, setContextPath] = useState<string | undefined>(undefined)
  const handledOpen = useRef(0)
  const sourceOf = props.sourceOf ?? v2FileSource
  const source = useMemo(
    () => (selectedId === undefined ? null : sourceOf({ sessionId, checkoutId: selectedId })),
    [sourceOf, sessionId, selectedId],
  )
  const attached = podAttached(status)
  usePodHold({ sessionId, active: attached })
  const { state, wakePod } = usePodWake({
    sessionId,
    live: attached,
    wake: () => requestWake(sessionId).then(() => undefined),
  })
  useEffect(() => {
    if (openRequest === undefined) return
    if (openRequest.kind === EPaneOpen.Changes) return
    if (handledOpen.current === openRequest.id) return
    const context = contextPathOf({ path: openRequest.path, sessionId })
    if (openRequest.kind === EPaneOpen.Context) {
      handledOpen.current = openRequest.id
      consumeOpenRequest(openRequest.id)
      setContextPath(context ?? openRequest.path)
      return
    }
    if (changes.status !== 'ready') return
    const target = checkoutPathOf({ path: openRequest.path, options, selectedId })
    handledOpen.current = openRequest.id
    consumeOpenRequest(openRequest.id)
    if (target === undefined) {
      if (context !== undefined) setContextPath(context)
      return
    }
    setContextPath(undefined)
    select(target.checkoutId)
    setOpenPath(target.path)
  }, [openRequest, changes.status, options, selectedId, select, consumeOpenRequest, sessionId])
  const handleOpened = useCallback(() => setOpenPath(undefined), [])
  const handleBack = useCallback(() => setContextPath(undefined), [])

  if (!attached) return <PodDisconnected tab="Files" state={state} onWake={wakePod} />
  if (contextPath !== undefined) {
    return (
      <ContextFileView
        sessionId={sessionId}
        path={contextPath}
        podAwake={attached}
        onBack={handleBack}
        sourceOf={sourceOf}
      />
    )
  }
  if (changes.status === 'loading') return <Loading />
  if (changes.status === 'failed') {
    return (
      <div data-files-tab={changes.unavailable ? 'unavailable' : 'failed'}>
        <Notice
          title={changes.unavailable ? 'Change storage unavailable' : 'Files unavailable'}
          description={changes.message}
        />
      </div>
    )
  }
  if (source === null || selectedId === undefined) {
    return (
      <div data-files-tab="empty">
        <Notice
          title="No checkout yet"
          description="Files appear once the workspace repository is ready."
        />
      </div>
    )
  }
  return (
    <FilesBody
      key={selectedId}
      sessionId={sessionId}
      source={source}
      podAwake={attached}
      openPath={openPath}
      onOpened={handleOpened}
    />
  )
}

export const FILES_TAB_ICON = <FolderTreeIcon />
