import { EAgentDisplay } from '@dltech/atlas-ui/ai/agent-status'
import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { EBootStepState, SandboxBoot, type SandboxBootStep } from '@dltech/atlas-ui/ai/sandbox-boot'
import { EToolKind, EToolState, Tool } from '@dltech/atlas-ui/ai/tool'

import type { AppTeammate } from '../shell/fixtures/teammates'
import { teammateDisplay } from '../shell/teammate-display'

const BOOT_STEPS: SandboxBootStep[] = [
  { id: 'create', label: 'Create sandbox', state: EBootStepState.Done },
  { id: 'clone', label: 'Clone repository', state: EBootStepState.Done },
  { id: 'install', label: 'Install dependencies', state: EBootStepState.Running },
  { id: 'serve', label: 'Start the session', state: EBootStepState.Pending },
]

interface ToolSpec {
  id: string
  kind: EToolKind
  label: string
  elapsed?: string
}

const TOOLS: ToolSpec[] = [
  { id: 't1', kind: EToolKind.Search, label: 'the affected modules', elapsed: '2s' },
  { id: 't2', kind: EToolKind.Read, label: 'the existing tests', elapsed: '1s' },
  { id: 't3', kind: EToolKind.Edit, label: 'the files in scope', elapsed: '4s' },
]

const FINAL_STATE: Partial<Record<EAgentDisplay, EToolState>> = {
  [EAgentDisplay.Running]: EToolState.Running,
  [EAgentDisplay.NeedsApproval]: EToolState.AwaitingApproval,
  [EAgentDisplay.Failed]: EToolState.Error,
}

function ToolLines({ display, outcome }: { display: EAgentDisplay; outcome?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {TOOLS.map((tool) => (
        <Tool key={tool.id} kind={tool.kind} label={tool.label} elapsed={tool.elapsed} />
      ))}
      <Tool
        kind={EToolKind.Shell}
        label="bun test"
        state={FINAL_STATE[display] ?? EToolState.Done}
        errorText={outcome}
        elapsed={display === EAgentDisplay.Running ? undefined : '3m'}
      />
    </div>
  )
}

function Body({ teammate }: { teammate: AppTeammate }) {
  const display = teammateDisplay(teammate)
  if (display === EAgentDisplay.StartingSandbox) {
    return <SandboxBoot steps={BOOT_STEPS} state={EBootStepState.Running} elapsedMs={8400} />
  }
  return (
    <>
      <ToolLines display={display} outcome={teammate.outcome} />
      {teammate.outcome ? (
        <AgentMessage author="Atlas" timestamp="14:44">
          {teammate.outcome}
        </AgentMessage>
      ) : null}
    </>
  )
}

export function TeammateTranscript({ teammate }: { teammate: AppTeammate }) {
  return (
    <Chat className="min-h-0 flex-1">
      <ChatItem id="brief" anchor>
        <UserMessage author="Main thread" timestamp="14:04">
          {teammate.brief}
        </UserMessage>
      </ChatItem>
      <ChatItem id="body">
        <div className="flex flex-col gap-4">
          <Body teammate={teammate} />
        </div>
      </ChatItem>
    </Chat>
  )
}
