'use client'

import { ArrowLeftIcon } from 'lucide-react'
import { useMemo } from 'react'

import { EFilesRoot } from '@dltech/atlas-protocol'
import { Button } from '@dltech/atlas-ui/components/button'

import { FileBody } from '@/features/threads/context-viewer/file-viewer'
import type { FileSource } from '@/features/threads/data/file-source'
import { lineMarksOf } from '@/features/threads/data/line-marks'
import { useWorkspaceFile } from '@/features/threads/data/use-workspace-file'

export function ContextFileView(props: {
  sessionId: string
  path: string
  podAwake: boolean
  onBack: () => void
  sourceOf: (args: { sessionId: string; root: EFilesRoot }) => FileSource
}) {
  const source = useMemo(
    () => props.sourceOf({ sessionId: props.sessionId, root: EFilesRoot.Context }),
    [props.sessionId, props.sourceOf],
  )
  const loaded = useWorkspaceFile({ source, path: props.path, podAwake: props.podAwake })
  return (
    <section data-context-file={props.path} className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          Context · {props.path}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <FileBody loaded={loaded} path={props.path} marks={lineMarksOf([])} rendered={null} />
      </div>
    </section>
  )
}
