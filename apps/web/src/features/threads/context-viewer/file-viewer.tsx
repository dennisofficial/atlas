'use client'

import { useMemo, useState } from 'react'
import { ArrowLeftIcon, CodeIcon, EyeIcon, GitCompareIcon } from 'lucide-react'

import { CodeViewer } from '@dltech/atlas-ui/ai/code-viewer'
import { Button } from '@dltech/atlas-ui/components/button'
import { languageOfPath } from '@dltech/atlas-ui/lib/language-of-path'
import { EChangeScope } from '@dltech/atlas-wire/web'

import { lineMarksOf } from '../data/line-marks'
import { EGitChangesStatus, useGitChanges, useTurnEndCount } from '../data/use-git-changes'
import { useWorkspaceFile, type LoadedWorkspaceFile } from '../data/use-workspace-file'
import { useThreadPanel } from '../panel/thread-panel-context'
import { type ERenderKind, renderKindOf } from './context-model'
import { CopyButton, Notice } from './context-viewer'
import { RenderedFile } from './rendered-file'

export function FileBody(props: {
  loaded: LoadedWorkspaceFile
  path: string
  marks: ReturnType<typeof lineMarksOf>
  rendered: ERenderKind | null
}) {
  const { loaded, path, marks, rendered } = props
  if (loaded.state === 'loading') return <Notice>Reading file…</Notice>
  if (loaded.state === 'failed') return <Notice>File unavailable</Notice>
  if (loaded.file.type === 'refused') return <Notice>{loaded.file.reason}</Notice>
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {rendered === null ? (
          <CodeViewer
            path={path}
            content={loaded.file.content}
            language={languageOfPath(path)}
            marks={marks}
          />
        ) : (
          <RenderedFile kind={rendered} content={loaded.file.content} path={path} />
        )}
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
  const handleViewDiff = () => openChanges(path)
  const renderKind = renderKindOf(path)
  const [renderedPath, setRenderedPath] = useState<string | null>(null)
  const isRendered = renderKind !== null && renderedPath === path
  const handleToggleRender = () => setRenderedPath(isRendered ? null : path)

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
          <Button variant="outline" size="sm" onClick={handleViewDiff}>
            <GitCompareIcon />
            View diff
          </Button>
        )}
        {text === null || renderKind === null ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isRendered ? 'Show source' : 'Render file'}
            aria-pressed={isRendered}
            title={isRendered ? 'Show source' : 'Render file'}
            onClick={handleToggleRender}
          >
            {isRendered ? <CodeIcon /> : <EyeIcon />}
          </Button>
        )}
        {text === null ? null : <CopyButton text={text} />}
      </header>
      <div className="min-h-0 flex-1">
        <FileBody
          loaded={loaded}
          path={path}
          marks={marks}
          rendered={isRendered ? renderKind : null}
        />
      </div>
    </section>
  )
}
