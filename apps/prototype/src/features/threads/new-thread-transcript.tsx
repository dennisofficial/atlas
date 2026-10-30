import { Chat, ChatItem } from '@dltech/atlas-ui/ai/chat'
import { AgentMessage, UserMessage } from '@dltech/atlas-ui/ai/message'
import { WorkSummary } from '@dltech/atlas-ui/ai/work-summary'

import { Steps } from './transcript'
import { NoVercelTokenAlert } from './failure-alerts'
import { FIRST_TURN_REPLY, FIRST_TURN_STEPS, REPLY_WORDS } from './new-thread-data'
import { EFirstMessage, EPodProgress, isStartingPod } from './new-thread-types'
import { PodReadyLine, Provisioning } from './provisioning'

export interface NewThreadTranscriptProps {
  pod: EPodProgress
  message: EFirstMessage
  prompt: string
  elapsed: number
  visibleSteps: number
  replyWords: number
  onRetry: () => void
  onOpenFile: (path: string) => void
}

type TurnProps = Pick<
  NewThreadTranscriptProps,
  'message' | 'visibleSteps' | 'replyWords' | 'onOpenFile'
>

function Turn({ message, visibleSteps, replyWords, onOpenFile }: TurnProps) {
  const done = message === EFirstMessage.Done
  const reply =
    replyWords >= REPLY_WORDS.length ? FIRST_TURN_REPLY : REPLY_WORDS.slice(0, replyWords).join(' ')

  return (
    <div className="flex flex-col gap-4">
      <WorkSummary
        duration={done ? '9s' : `${Math.max(visibleSteps, 1)}s`}
        running={!done}
        defaultOpen
        stepCount={visibleSteps}
      >
        <Steps steps={FIRST_TURN_STEPS.slice(0, visibleSteps)} onOpenFile={onOpenFile} />
      </WorkSummary>
      {replyWords > 0 ? (
        <AgentMessage
          author="Atlas"
          timestamp="14:02"
          streaming={!done && replyWords < REPLY_WORDS.length}
        >
          {reply}
        </AgentMessage>
      ) : null}
    </div>
  )
}

function PodBlock(props: NewThreadTranscriptProps) {
  const { pod } = props
  if (pod === EPodProgress.NoVercelToken) return <NoVercelTokenAlert onRetry={props.onRetry} />
  if (isStartingPod(pod) || pod === EPodProgress.ProvisionFailed) {
    return <Provisioning pod={pod} elapsed={props.elapsed} onRetry={props.onRetry} />
  }
  return <PodReadyLine elapsed={props.elapsed} />
}

export function NewThreadTranscript(props: NewThreadTranscriptProps) {
  const sent = props.message !== EFirstMessage.None
  const turning = props.message === EFirstMessage.Running || props.message === EFirstMessage.Done

  return (
    <Chat className="min-h-0 flex-1">
      {sent ? (
        <ChatItem id="u1">
          <UserMessage author="Dennis" timestamp="14:02">
            {props.prompt}
          </UserMessage>
        </ChatItem>
      ) : null}
      <ChatItem id="pod">
        <PodBlock {...props} />
      </ChatItem>
      {turning ? (
        <ChatItem id="turn">
          <Turn
            message={props.message}
            visibleSteps={props.visibleSteps}
            replyWords={props.replyWords}
            onOpenFile={props.onOpenFile}
          />
        </ChatItem>
      ) : null}
    </Chat>
  )
}
