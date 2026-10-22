import { ESandboxNoticeState, type TranscriptSandbox } from '@dltech/atlas-client/transcript'
import { ESandboxState } from '@dltech/atlas-harness'

import type { SidebarContainer } from './sidebar-model'

const NOTICE_STATES: Record<ESandboxState, ESandboxNoticeState> = {
  [ESandboxState.Starting]: ESandboxNoticeState.Starting,
  [ESandboxState.Running]: ESandboxNoticeState.Running,
  [ESandboxState.Stopped]: ESandboxNoticeState.Stopped,
  [ESandboxState.Failed]: ESandboxNoticeState.Failed,
}

export const transcriptSandboxOf = (sandbox: SidebarContainer | null): TranscriptSandbox | null =>
  sandbox === null
    ? null
    : { state: NOTICE_STATES[sandbox.state], label: sandbox.label, reason: sandbox.reason }
