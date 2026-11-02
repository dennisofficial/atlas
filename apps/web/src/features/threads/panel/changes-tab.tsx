'use client'

import { useEffect, useRef, useState } from 'react'
import { GitCompareIcon } from 'lucide-react'

import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { ChangesPanel } from '@dltech/atlas-ui/ai/changes-panel'
import { EChangeScope } from '@dltech/atlas-wire/web'

import { CHANGE_SCOPES, changeScopeOf } from '../data/git-changes-map'
import type { GitChangesChannel } from '../data/git-changes-load'
import { EGitChangesStatus, useGitChanges } from '../data/use-git-changes'
import { findChangedRow, resolveChangedPath, withExpanded } from './changes/focus-changed-path'
import { ETabSubject } from './changes/offline-copy'
import { TabFailed, TabOffline } from './changes/tab-states'
import { ChangesLoading } from './changes/tab-skeletons'
import { useThreadPanel } from './thread-panel-context'

const ICON = <GitCompareIcon />

function useFocusedPath(args: {
  changesPath: string | undefined
  files: Parameters<typeof resolveChangedPath>[0]['files'] | null
  scope: EChangeScope
  onWiden: () => void
  onFocus: (path: string) => void
}) {
  const { changesPath, files, scope, onWiden, onFocus } = args
  const handled = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (changesPath === undefined) {
      handled.current = undefined
      return
    }
    if (files === null || handled.current === changesPath) return
    const target = resolveChangedPath({ files, path: changesPath })
    if (target === undefined && scope !== EChangeScope.All) {
      onWiden()
      return
    }
    handled.current = changesPath
    if (target !== undefined) onFocus(target)
  }, [changesPath, files, scope, onWiden, onFocus])
}

function ChangesBody(props: { channel: GitChangesChannel }) {
  const { working, changesPath } = useThreadPanel()
  const [scope, setScope] = useState(EChangeScope.All)
  const [expanded, setExpanded] = useState<string[]>([])
  const [scrollTarget, setScrollTarget] = useState<string | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const { view } = useGitChanges({ channel: props.channel, scope, working })

  const files = view.status === EGitChangesStatus.Ready ? view.files : null

  const handleWiden = () => setScope(EChangeScope.All)
  const handleFocus = (path: string) => {
    setExpanded((current) => withExpanded({ expanded: current, path }))
    setScrollTarget(path)
  }
  useFocusedPath({
    changesPath,
    files,
    scope,
    onWiden: handleWiden,
    onFocus: handleFocus,
  })

  useEffect(() => {
    if (scrollTarget === undefined || root.current === null) return
    findChangedRow({
      root: root.current,
      path: scrollTarget,
    })?.scrollIntoView?.({
      block: 'start',
    })
    setScrollTarget(undefined)
  }, [scrollTarget])

  const handleScopeChange = (id: string) => {
    const next = changeScopeOf(id)
    if (next !== undefined) setScope(next)
  }

  if (view.status === EGitChangesStatus.Failed) {
    return <TabFailed icon={ICON} title="Changes unavailable" message={view.message} />
  }
  if (view.status === EGitChangesStatus.Loading) return <ChangesLoading />

  return (
    <div ref={root} className="flex h-full min-h-0 flex-col">
      {view.truncated ? (
        <div className="shrink-0 border-b border-border p-2">
          <Alert>
            <AlertDescription>
              Too many files changed to list them all. Narrow the scope to see the rest.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <ChangesPanel
          files={view.files}
          scopes={CHANGE_SCOPES}
          scope={scope}
          onScopeChange={handleScopeChange}
          expanded={expanded}
          onExpandedChange={setExpanded}
        />
      </div>
    </div>
  )
}

export function ChangesTab() {
  const { channel, pod } = useThreadPanel()
  if (channel === null) return <TabOffline pod={pod} subject={ETabSubject.Changes} icon={ICON} />
  return <ChangesBody channel={channel} />
}
