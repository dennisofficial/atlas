import { EPodState } from '@dltech/atlas-ui/ai/pod-status-chip'
import { ETerminalConnection } from '@dltech/atlas-ui/ai/terminal-states'
import { FolderGit2Icon } from 'lucide-react'

import type { Control, Values } from '@/proto/use-prototype'

import { type AppThread, SESSION_THREAD_ID } from '../shell/fixtures/app'
import { enumValueOf } from './enum-value'
import { projectLabelOf } from './new-thread-data'
import { RUNNING_POD, type PodChipConfig } from './pod-status'
import { MAX_QUEUED } from './queue-fixtures'
import type { SessionViewProps } from './session-view'
import { ERightTab, ESessionState } from './session-types'

export enum EPodTweak {
  None = 'none',
  Running = 'running',
  Parked = 'parked',
  ResizePending = 'resize-pending',
}

export const THREAD_CONTROLS = {
  state: {
    type: 'select',
    label: 'Session state',
    options: Object.values(ESessionState),
    default: ESessionState.Running,
  },
  tab: {
    type: 'select',
    label: 'Right tab',
    options: Object.values(ERightTab),
    default: ERightTab.Agents,
  },
  terminal: {
    type: 'select',
    label: 'Terminal',
    options: Object.values(ETerminalConnection),
    default: ETerminalConnection.Connected,
  },
  pod: {
    type: 'select',
    label: 'Pod',
    options: Object.values(EPodTweak),
    default: EPodTweak.None,
  },
  detail: { type: 'boolean', label: 'Agent detail', default: false },
  queued: { type: 'range', label: 'Queued', min: 0, max: MAX_QUEUED, step: 1, default: 2 },
} satisfies Record<string, Control>

export type ThreadTweaks = Values<typeof THREAD_CONTROLS>

export function podChipFor(pod: EPodTweak): PodChipConfig | undefined {
  if (pod === EPodTweak.None) return undefined
  const status = {
    [EPodTweak.Running]: RUNNING_POD,
    [EPodTweak.Parked]: { ...RUNNING_POD, state: EPodState.Parked },
    [EPodTweak.ResizePending]: { ...RUNNING_POD, pendingVcpus: 8 },
  }[pod]
  return { status, defaultOpen: true }
}

export function headerFor({
  thread,
  pod,
}: {
  thread: AppThread | undefined
  pod: EPodTweak
}): SessionViewProps['header'] {
  const podStatus = podChipFor(pod)
  if (!thread || thread.id === SESSION_THREAD_ID) return { podStatus }
  return {
    title: thread.title,
    subtitle: { label: projectLabelOf(thread.projectId), icon: FolderGit2Icon },
    podStatus,
  }
}

export function tweaksOf(values: ThreadTweaks) {
  return {
    state: enumValueOf({
      options: Object.values(ESessionState),
      value: values.state,
      fallback: ESessionState.Running,
    }),
    tab: enumValueOf({
      options: Object.values(ERightTab),
      value: values.tab,
      fallback: ERightTab.Agents,
    }),
    terminal: enumValueOf({
      options: Object.values(ETerminalConnection),
      value: values.terminal,
      fallback: ETerminalConnection.Connected,
    }),
    pod: enumValueOf({
      options: Object.values(EPodTweak),
      value: values.pod,
      fallback: EPodTweak.None,
    }),
  }
}
