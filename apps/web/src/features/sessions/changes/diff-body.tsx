'use client'

import { DiffViewer, type DiffLine } from '@dltech/atlas-ui/ai/diff-viewer'
import { type ChangedFile as ChangedFileEntry, EChangeFileStatus } from '@dltech/atlas-protocol'
import { type SyntheticEvent, useEffect, useRef, useState } from 'react'

import { binaryLabel, renameLabel, workingTreeFileOf } from './rows'
import { type ChangedFileState, useChangedFile } from './use-changed-file'

export const ROW_HEIGHT = 20
export const OVERSCAN = 20
export const DEFAULT_VIEWPORT = 384

export function visibleSliceOf(args: { total: number; scrollTop: number; viewport: number }): {
  start: number
  end: number
} {
  if (args.total === 0) return { start: 0, end: 0 }
  const first = Math.floor(args.scrollTop / ROW_HEIGHT)
  const last = Math.ceil((args.scrollTop + args.viewport) / ROW_HEIGHT)
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(args.total, last + OVERSCAN),
  }
}

function VirtualDiff({ file, lines }: { file: ChangedFileEntry; lines: DiffLine[] }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT)
  useEffect(() => {
    const node = scroller.current
    if (node !== null && node.clientHeight > 0) setViewport(node.clientHeight)
  }, [])
  const { start, end } = visibleSliceOf({ total: lines.length, scrollTop, viewport })
  const handleScroll = (event: SyntheticEvent<HTMLDivElement>) =>
    setScrollTop(event.currentTarget.scrollTop)
  return (
    <div
      ref={scroller}
      onScroll={handleScroll}
      data-diff-scroll={lines.length}
      data-diff-window={`${start}:${end}`}
      className="max-h-96 overflow-auto"
    >
      <div style={{ height: start * ROW_HEIGHT }} aria-hidden />
      <DiffViewer
        path={file.path}
        lines={lines.slice(start, end)}
        added={file.additions}
        removed={file.deletions}
      />
      <div style={{ height: (lines.length - end) * ROW_HEIGHT }} aria-hidden />
    </div>
  )
}

function Body({ state }: { state: ChangedFileState }) {
  if (state.status === 'loading') {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading diff…
      </p>
    )
  }
  if (state.status === 'failed') {
    return <p className="text-xs text-muted-foreground">{state.message}</p>
  }
  if (state.status === 'idle') {
    return <p className="text-xs text-muted-foreground">No diff to show for this file.</p>
  }
  return null
}

export function DiffBody(args: { sessionId: string; checkoutId: string; file: ChangedFileEntry }) {
  const working = workingTreeFileOf(args.file)
  const state = useChangedFile({
    sessionId: args.sessionId,
    checkoutId: args.checkoutId,
    file: args.file,
  })
  const rename = renameLabel(working)
  const deleted = args.file.status === EChangeFileStatus.Deleted
  return (
    <div data-diff-body={args.file.path} className="flex flex-col gap-1.5">
      {rename === null ? null : (
        <p className="text-xs text-muted-foreground" data-diff-rename>
          {rename}
        </p>
      )}
      {deleted ? (
        <p className="text-xs text-muted-foreground" data-diff-deleted>
          Deleted file
        </p>
      ) : null}
      {args.file.binary ? (
        <p className="text-xs text-muted-foreground" data-diff-binary>
          {binaryLabel(working)}
        </p>
      ) : (
        <Body state={state} />
      )}
      {args.file.binary ? null : state.status === 'ready' ? (
        <VirtualDiff file={args.file} lines={state.lines} />
      ) : null}
    </div>
  )
}
