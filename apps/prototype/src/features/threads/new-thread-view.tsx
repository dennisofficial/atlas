import { useMemo } from 'react'

import { Kbd } from '@dltech/atlas-ui/components/kbd'
import { TooltipProvider } from '@dltech/atlas-ui/components/tooltip'

import { useRegisterPendingThread } from '../shell/pending-thread'
import { Composer } from './composer'
import { SessionView } from './session-view'
import { DEFAULT_PROJECT_ID, MODEL_LABEL, pendingThreadOf, titleOf } from './new-thread-data'
import { useNewThreadFlow, type NewThreadFlow } from './new-thread-flow'
import { podStateOf } from './new-thread-pod'
import { NewThreadTranscript } from './new-thread-transcript'
import {
  EFirstMessage,
  ENewThreadOutcome,
  EPodProgress,
  isFailedPod,
  isStartingPod,
} from './new-thread-types'
import { ProjectPicker } from './project-picker'

export interface NewThreadViewProps {
  initialPod?: EPodProgress
  initialMessage?: EFirstMessage
  initialProjectId?: string | null
  outcome?: ENewThreadOutcome
  autoRun?: boolean
}

function badgeLabelOf({
  pod,
  message,
}: {
  pod: EPodProgress
  message: EFirstMessage
}): string | null {
  if (message === EFirstMessage.Done) return 'Idle'
  return isFailedPod(pod) ? 'Failed' : null
}

function placeholderOf({
  pod,
  message,
}: {
  pod: EPodProgress
  message: EFirstMessage
}): string | undefined {
  if (message === EFirstMessage.Running) return 'Queue a message for when Atlas is done…'
  if (isStartingPod(pod) && message === EFirstMessage.None)
    return 'The pod is still starting — you can write your message now…'
  return undefined
}

function TakeBackHint({ starting }: { starting: boolean }) {
  return (
    <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
      <Kbd>Esc</Kbd>
      <span>
        {starting ? 'to edit your message — the pod keeps starting' : 'to edit your message'}
      </span>
    </p>
  )
}

function Welcome({ flow }: { flow: NewThreadFlow }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-16">
      <h1 className="text-xl font-medium tracking-tight">What should Atlas work on?</h1>
      <Composer
        value={flow.draft}
        onValueChange={flow.handleDraftChange}
        onSend={flow.handleSend}
        placeholder="Describe a task for Atlas…"
        showContext={false}
        className="max-w-2xl pb-0"
      >
        <div className="ml-auto flex min-w-0">
          <ProjectPicker projectId={flow.projectId} onProjectChange={flow.handleProjectChange} />
        </div>
      </Composer>
    </div>
  )
}

export function NewThreadView({
  initialPod = EPodProgress.None,
  initialMessage = EFirstMessage.None,
  initialProjectId = DEFAULT_PROJECT_ID,
  outcome = ENewThreadOutcome.Success,
  autoRun = false,
}: NewThreadViewProps) {
  const flow = useNewThreadFlow({ initialPod, initialMessage, initialProjectId, outcome, autoRun })
  const { pod, message, prompt, projectId } = flow
  const pendingThread = useMemo(
    () => pendingThreadOf({ prompt, projectId, pod, message }),
    [prompt, projectId, pod, message],
  )
  useRegisterPendingThread(pendingThread)

  if (pod === EPodProgress.None) {
    return (
      <TooltipProvider>
        <Welcome flow={flow} />
      </TooltipProvider>
    )
  }

  return (
    <SessionView
      header={{
        title: titleOf(flow.prompt),
        detail: MODEL_LABEL,
        badgeLabel: badgeLabelOf({ pod, message }),
      }}
      pod={podStateOf({
        pod,
        projectId: flow.projectId,
        visibleSteps: flow.visibleSteps,
        onRetry: flow.handleRetry,
      })}
      renderTranscript={({ onOpenFile }) => (
        <NewThreadTranscript
          pod={pod}
          message={message}
          prompt={flow.prompt}
          elapsed={flow.elapsed}
          visibleSteps={flow.visibleSteps}
          replyWords={flow.replyWords}
          onRetry={flow.handleRetry}
          onOpenFile={onOpenFile}
        />
      )}
      composer={
        <Composer
          value={flow.draft}
          onValueChange={flow.handleDraftChange}
          onSend={flow.handleSend}
          placeholder={placeholderOf({ pod, message })}
          busy={message === EFirstMessage.Running}
          queued={flow.queued}
          onSaveQueued={flow.handleSaveQueued}
          onRemoveQueued={flow.handleRemoveQueued}
          showContext={false}
          onEscape={flow.handleTakeBack}
          hint={
            message === EFirstMessage.Pending ? (
              <TakeBackHint starting={isStartingPod(pod)} />
            ) : undefined
          }
        />
      }
    />
  )
}
