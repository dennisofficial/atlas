'use client'

import { useId, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { SearchIcon, SearchXIcon } from 'lucide-react'

import { FileSearchResults } from '@dltech/atlas-ui/ai/file-search-results'
import type { EFileChange } from '@dltech/atlas-ui/ai/file-tree'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import { ESearchKeyAction, searchKeyResult } from '../data/file-search-keys'
import { EFileSearchStatus, useFileSearch } from '../data/use-file-search'
import type { FileSearchChannel } from '../data/file-search-source'
import { TabPlaceholder } from './tab-placeholder'

type SearchProps = {
  channel: FileSearchChannel
  refreshKey: number
  changes: ReadonlyMap<string, EFileChange>
  ignored: ReadonlySet<string>
  selected: string | undefined
  onOpen: (path: string) => void
  children: ReactNode
}

const isIgnoredPath = (args: { path: string; ignored: ReadonlySet<string> }): boolean => {
  const segments = args.path.split('/')
  return segments.some((_, index) => args.ignored.has(segments.slice(0, index + 1).join('/')))
}

function FileSearchInput(props: {
  query: string
  onQueryChange: (query: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  listId: string
  activeId: string | undefined
  busy: boolean
}) {
  const handleChange = (event: { target: { value: string } }) =>
    props.onQueryChange(event.target.value)
  return (
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="text"
        role="combobox"
        aria-label="Search files by name"
        aria-expanded={props.query.trim() !== ''}
        aria-controls={props.listId}
        aria-activedescendant={props.activeId}
        aria-autocomplete="list"
        placeholder="Search files"
        autoComplete="off"
        spellCheck={false}
        value={props.query}
        onChange={handleChange}
        onKeyDown={props.onKeyDown}
      />
      {props.busy ? (
        <InputGroupAddon align="inline-end">
          <Spinner />
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  )
}

export function FileSearchBody(props: SearchProps) {
  const { channel, refreshKey } = props
  const [query, setQuery] = useState('')
  const listId = useId()
  const view = useFileSearch({ channel, query, refreshKey })
  const [moved, setMoved] = useState(0)

  const hits = useMemo(
    () =>
      view.status === EFileSearchStatus.Ready
        ? view.paths.map((hit) => {
            const change = props.changes.get(hit.path)
            return {
              ...hit,
              ...(change === undefined ? {} : { change }),
              ...(isIgnoredPath({ path: hit.path, ignored: props.ignored })
                ? { ignored: true }
                : {}),
            }
          })
        : [],
    [view, props.changes, props.ignored],
  )
  const active = Math.min(moved, Math.max(hits.length - 1, 0))

  const handleQueryChange = (next: string) => {
    setMoved(0)
    setQuery(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const result = searchKeyResult({ key: event.key, active, count: hits.length })
    if (result.action === ESearchKeyAction.None) return
    event.preventDefault()
    if (result.action === ESearchKeyAction.Clear) handleQueryChange('')
    if (result.action === ESearchKeyAction.Move) setMoved(result.active)
    if (result.action === ESearchKeyAction.Open) {
      const hit = hits[active]
      if (hit !== undefined) props.onOpen(hit.path)
    }
  }

  const searching = query.trim() !== ''
  const activeId = hits.length === 0 ? undefined : `${listId}-${active}`

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <FileSearchInput
        query={query}
        onQueryChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        listId={listId}
        activeId={activeId}
        busy={view.status === EFileSearchStatus.Loading}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {searching ? (
          <Results
            view={view}
            hits={hits}
            active={active}
            listId={listId}
            selected={props.selected}
            onOpen={props.onOpen}
            onActiveChange={setMoved}
          />
        ) : (
          props.children
        )}
      </div>
    </div>
  )
}

function Results(props: {
  view: ReturnType<typeof useFileSearch>
  hits: React.ComponentProps<typeof FileSearchResults>['hits']
  active: number
  listId: string
  selected: string | undefined
  onOpen: (path: string) => void
  onActiveChange: (index: number) => void
}) {
  const { view } = props
  const icon = <SearchXIcon />
  if (view.status === EFileSearchStatus.Unsupported) {
    return (
      <TabPlaceholder
        icon={icon}
        title="Search needs a newer serve"
        description="This sandbox runs an older Atlas serve. Start a new session to search files."
      />
    )
  }
  if (view.status === EFileSearchStatus.Failed) {
    return <TabPlaceholder icon={icon} title="Search failed" description={view.message} />
  }
  if (view.status === EFileSearchStatus.Ready && props.hits.length === 0) {
    return (
      <TabPlaceholder
        icon={icon}
        title="No matching files"
        description="Check the spelling, or search by part of the file or folder name."
      />
    )
  }
  if (props.hits.length === 0) return null
  return (
    <>
      <FileSearchResults
        hits={props.hits}
        active={props.active}
        listId={props.listId}
        onSelect={props.onOpen}
        onActiveChange={props.onActiveChange}
      />
      {view.status === EFileSearchStatus.Ready && view.truncated ? (
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          Showing the best {props.hits.length} matches. Keep typing to narrow them.
        </p>
      ) : null}
    </>
  )
}
