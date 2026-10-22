import { useState } from 'react'
import { FileDiffIcon, FolderIcon, GlobeIcon, TerminalIcon } from 'lucide-react'

import { ChangesPanel, type ChangeScopeOption } from '@dltech/atlas-ui/ai/changes-panel'
import { FileTree } from '@dltech/atlas-ui/ai/file-tree'

import { EPodPhase, terminalConnectionOf, type PodPanelState } from './pod-state'
import { TerminalTab } from './terminal-tab'
import { Notice } from './terminal-states'

interface PodPanelProps {
  pod: PodPanelState
}

interface PodChangesProps extends PodPanelProps {
  expanded: string[]
  onExpandedChange: (paths: string[]) => void
}

const SCOPES: ChangeScopeOption[] = [{ id: 'all', label: 'All changes' }]

const FILES_NOTICE: Record<EPodPhase, { title: string; description: string }> = {
  [EPodPhase.None]: { title: 'No pod yet', description: 'Send a message to start a pod.' },
  [EPodPhase.Starting]: {
    title: 'Waiting for the pod',
    description: 'Files appear once the workspace is set up.',
  },
  [EPodPhase.Failed]: { title: 'No pod to browse', description: 'The pod did not start.' },
  [EPodPhase.Ready]: { title: 'No files yet', description: 'This workspace has no project files.' },
}

export function PodChanges({ pod, expanded, onExpandedChange }: PodChangesProps) {
  const [scope, setScope] = useState('all')

  if (pod.changedFiles.length === 0) {
    return (
      <Notice
        icon={<FileDiffIcon />}
        title="No changes yet"
        description="Files Atlas edits in this pod show up here."
      />
    )
  }

  return (
    <ChangesPanel
      files={pod.changedFiles}
      scopes={SCOPES}
      scope={scope}
      onScopeChange={setScope}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    />
  )
}

export function PodFiles({ pod }: PodPanelProps) {
  const [selected, setSelected] = useState<string>()
  const ready = pod.phase === EPodPhase.Ready && pod.files.length > 0

  if (!ready) {
    const { title, description } = FILES_NOTICE[pod.phase]
    return <Notice icon={<FolderIcon />} title={title} description={description} />
  }

  return (
    <div className="h-full overflow-auto p-2">
      <FileTree nodes={pod.files} selected={selected} onSelect={setSelected} />
    </div>
  )
}

export function PodTerminal({ pod }: PodPanelProps) {
  const connection = terminalConnectionOf(pod.phase)

  if (connection === undefined) {
    return (
      <Notice
        icon={<TerminalIcon />}
        title="No pod yet"
        description="Send a message to start a pod, then open a shell in it."
      />
    )
  }

  return (
    <TerminalTab
      key={pod.phase}
      initialConnection={connection}
      terminals={pod.terminals}
      noun="pod"
      disconnectedMessage="The pod did not start."
      onReconnect={pod.onRetry}
    />
  )
}

export function PodPreview() {
  return (
    <Notice
      icon={<GlobeIcon />}
      title="No previews yet"
      description="Servers you start in the pod show up here."
    />
  )
}
