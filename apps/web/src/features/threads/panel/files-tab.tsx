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
import { TabFailed, TabOffline } from './changes/tab-states'
import { FilesLoading } from './changes/tab-skeletons'
import { FileSearchBody } from './file-search-panel'
import { useThreadPanel } from './thread-panel-context'

const ICON = <FolderTreeIcon />

function FilesBody(props: { channel: FileTreeChannel & GitChangesChannel }) {
  const { working, openFile } = useThreadPanel()
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const turnEnds = useTurnEndCount(working)
  const {
    view: tree,
    open,
    setOpen,
  } = useFileTree({ channel: props.channel, refreshKey: turnEnds })
  const { view: changes } = useGitChanges({
    channel: props.channel,
    scope: EChangeScope.All,
    working,
  })
  const changed = useMemo(
    () => changeByPath(changes.status === EGitChangesStatus.Ready ? changes.files : []),
    [changes],
  )
  const ignored = useMemo(
    () => new Set(changes.status === EGitChangesStatus.Ready ? changes.ignored : []),
    [changes],
  )
  const nodes = useMemo(
    () =>
      tree.status === EFileTreeStatus.Ready
        ? nodesOf({ listings: tree.listings, changes: changed, ignored })
        : [],
    [tree, changed, ignored],
  )

  const handleOpenChange = (change: { path: string; open: boolean }) =>
    setOpen({ directory: change.path, open: change.open })

  const handleSelect = (path: string) => {
    setSelected(path)
    openFile(path)
  }

  if (tree.status === EFileTreeStatus.Failed) {
    return <TabFailed icon={ICON} title="Files unavailable" message={tree.message} />
  }
  if (tree.status === EFileTreeStatus.Loading) return <FilesLoading />
  if (nodes.length === 0) {
    return (
      <TabFailed icon={ICON} title="No files yet" message="This workspace has no project files." />
    )
  }

  return (
    <FileSearchBody
      channel={props.channel}
      refreshKey={turnEnds}
      changes={changed}
      ignored={ignored}
      selected={selected}
      onOpen={handleSelect}
    >
      <FileTree
        nodes={nodes}
        selected={selected}
        onSelect={handleSelect}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </FileSearchBody>
  )
}

export function FilesTab() {
  const { channel, pod } = useThreadPanel()
  if (channel === null) return <TabOffline pod={pod} subject={ETabSubject.Files} icon={ICON} />
  return <FilesBody channel={channel} />
}
