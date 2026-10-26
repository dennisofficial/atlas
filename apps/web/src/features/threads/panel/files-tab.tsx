'use client'

import { useMemo, useState } from 'react'
import { FolderTreeIcon } from 'lucide-react'

import { FileTree } from '@dltech/atlas-ui/ai/file-tree'

import { nodesOf } from '../data/file-tree-nodes'
import { changeByPath } from '../data/git-changes-map'
import { EFileTreeStatus, useFileTree } from '../data/use-file-tree'
import { EGitChangesStatus, useGitChanges, useTurnEndCount } from '../data/use-git-changes'
import { EChangeScope } from '@dltech/atlas-wire/web'
import type { FileTreeChannel } from '../data/file-tree-source'
import type { GitChangesChannel } from '../data/git-changes-load'
import { ETabSubject } from './changes/offline-copy'
import { TabFailed, TabLoading, TabOffline } from './changes/tab-states'
import { useThreadPanel } from './thread-panel-context'

const ICON = <FolderTreeIcon />

function FilesBody(props: { channel: FileTreeChannel & GitChangesChannel }) {
  const { working, openChanges } = useThreadPanel()
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const turnEnds = useTurnEndCount(working)
  const tree = useFileTree({ channel: props.channel, refreshKey: turnEnds })
  const { view: changes } = useGitChanges({
    channel: props.channel,
    scope: EChangeScope.All,
    working,
  })
  const changed = useMemo(
    () => changeByPath(changes.status === EGitChangesStatus.Ready ? changes.files : []),
    [changes],
  )
  const nodes = useMemo(
    () =>
      tree.status === EFileTreeStatus.Ready
        ? nodesOf({ listings: tree.listings, changes: changed })
        : [],
    [tree, changed],
  )

  const handleSelect = (path: string) => {
    setSelected(path)
    if (changed.has(path)) openChanges(path)
  }

  if (tree.status === EFileTreeStatus.Failed) {
    return <TabFailed icon={ICON} title="Files unavailable" message={tree.message} />
  }
  if (tree.status === EFileTreeStatus.Loading) return <TabLoading />
  if (nodes.length === 0) {
    return (
      <TabFailed icon={ICON} title="No files yet" message="This workspace has no project files." />
    )
  }

  return (
    <div className="h-full overflow-auto p-2">
      <FileTree nodes={nodes} selected={selected} onSelect={handleSelect} defaultOpen={false} />
    </div>
  )
}

export function FilesTab() {
  const { channel, pod } = useThreadPanel()
  if (channel === null) return <TabOffline pod={pod} subject={ETabSubject.Files} icon={ICON} />
  return <FilesBody channel={channel} />
}
