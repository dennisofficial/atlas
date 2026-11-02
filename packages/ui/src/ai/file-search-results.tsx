'use client'

import { FileIcon } from 'lucide-react'

import { Button } from '#components/button'
import { cn } from '#lib/utils'

import { EFileChange, nameClassOf } from './file-tree'

export interface FileSearchHit {
  path: string
  positions: number[]
  change?: EFileChange
  ignored?: boolean
}

export interface FileSearchResultsProps {
  hits: FileSearchHit[]
  active: number
  onSelect?: (path: string) => void
  onActiveChange?: (index: number) => void
  listId?: string
}

export function optionIdOf(args: { listId: string; index: number }): string {
  return `${args.listId}-${args.index}`
}

export function splitPath(path: string): { directory: string; name: string; nameStart: number } {
  const nameStart = path.lastIndexOf('/') + 1
  return { directory: path.slice(0, nameStart), name: path.slice(nameStart), nameStart }
}

function Highlighted({
  text,
  offset,
  positions,
}: {
  text: string
  offset: number
  positions: Set<number>
}) {
  return (
    <>
      {matchRunsOf({ text, offset, positions }).map((run, index) =>
        run.matched ? (
          <mark key={index} className="rounded-xs bg-primary/25 text-inherit">
            {run.text}
          </mark>
        ) : (
          run.text
        ),
      )}
    </>
  )
}

export function matchRunsOf(args: {
  text: string
  offset: number
  positions: Set<number>
}): { text: string; matched: boolean }[] {
  const runs: { text: string; matched: boolean }[] = []
  ;[...args.text].forEach((character, index) => {
    const matched = args.positions.has(args.offset + index)
    const last = runs.at(-1)
    if (last !== undefined && last.matched === matched) {
      last.text += character
      return
    }
    runs.push({ text: character, matched })
  })
  return runs
}

export function FileSearchResults({
  hits,
  active,
  onSelect,
  onActiveChange,
  listId = 'file-search',
}: FileSearchResultsProps) {
  return (
    <div role="listbox" id={listId} aria-label="Matching files" className="flex flex-col">
      {hits.map((hit, index) => {
        const { directory, name, nameStart } = splitPath(hit.path)
        const positions = new Set(hit.positions)
        const handleSelect = () => onSelect?.(hit.path)
        const handleHover = () => onActiveChange?.(index)
        return (
          <Button
            key={hit.path}
            id={optionIdOf({ listId, index })}
            role="option"
            tabIndex={-1}
            variant="tree"
            size="sm"
            aria-selected={index === active}
            aria-current={index === active ? 'true' : undefined}
            className="w-full justify-start font-mono text-xs"
            onClick={handleSelect}
            onMouseMove={handleHover}
          >
            <FileIcon />
            <span className={cn(nameClassOf(hit), 'shrink-0')}>
              <Highlighted text={name} offset={nameStart} positions={positions} />
            </span>
            <span className="truncate text-muted-foreground">
              <Highlighted text={directory} offset={0} positions={positions} />
            </span>
            {hit.change ? <span className="sr-only">, {hit.change}</span> : null}
            {hit.ignored && hit.change === undefined ? (
              <span className="sr-only">, ignored by git</span>
            ) : null}
          </Button>
        )
      })}
    </div>
  )
}
