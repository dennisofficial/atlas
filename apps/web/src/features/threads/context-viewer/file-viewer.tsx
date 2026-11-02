'use client'

import { useMemo } from 'react'
import { ArrowLeftIcon, GitCompareIcon } from 'lucide-react'

import { CodeViewer } from '@dltech/atlas-ui/ai/code-viewer'
import { Button } from '@dltech/atlas-ui/components/button'
import { languageOfPath } from '@dltech/atlas-ui/lib/language-of-path'
import { EChangeScope } from '@dltech/atlas-wire/web'

import { lineMarksOf } from '../data/line-marks'
import { EGitChangesStatus, useGitChanges, useTurnEndCount } from '../data/use-git-changes'
import { useWorkspaceFile, type LoadedWorkspaceFile } from '../data/use-workspace-file'
import { useThreadPanel } from '../panel/thread-panel-context'
import { CopyButton, Notice } from './context-viewer'

function Body(props: {
  loaded: LoadedWorkspaceFile
  path: string
  marks: ReturnType<typeof lineMarksOf>
}) {
  const { loaded, path, marks } = props
  if (loaded.state === 'loading') return <Notice>Reading file…</Notice>
  if (loaded.state === 'failed') return <Notice>File unavailable</Notice>
  if (loaded.file.type === 'refused') return <Notice>{loaded.file.reason}</Notice>
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <CodeViewer
          path={path}
          content={loaded.file.content}
          language={languageOfPath(path)}
          marks={marks}
        />
      </div>
      {loaded.file.truncated ? <Notice>Truncated</Notice> : null}
    </div>
  )
}

export function FileViewer({ path }: { path: string }) {
  const { channel, working, closeFile, openChanges } = useThreadPanel()
  const turnEnds = useTurnEndCount(working)
  const loaded = useWorkspaceFile({ channel, path, refreshKey: turnEnds })
  const { view } = useGitChanges({ channel, scope: EChangeScope.All, working })
  const changedFile = useMemo(
    () =>
      view.status === EGitChangesStatus.Ready
        ? view.files.find((file) => file.path === path)
        : undefined,
    [view, path],
  )
  const marks = useMemo(() => lineMarksOf(changedFile?.lines ?? []), [changedFile])
  const text = loaded.state === 'ready' && loaded.file.type === 'text' ? loaded.file.content : null

  return (
    <section aria-label="File" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" aria-label="Back" onClick={closeFile}>
          <ArrowLeftIcon />
          Back
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={path}>
          {path}
        </p>
        {changedFile === undefined ? null : (
          <Button variant="outline" size="sm" onClick={() => openChanges(path)}>
            <GitCompareIcon />
            View diff
          </Button>
        )}
        {text === null ? null : <CopyButton text={text} />}
      </header>
      <div className="min-h-0 flex-1">
        <Body loaded={loaded} path={path} marks={marks} />
      </div>
    </section>
  )
}
