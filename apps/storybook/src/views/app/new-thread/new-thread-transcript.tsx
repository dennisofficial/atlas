import { Chat, ChatItem } from "@dltech/atlas-ui/ai/chat";
import { AgentMessage, UserMessage } from "@dltech/atlas-ui/ai/message";
import { WorkSummary } from "@dltech/atlas-ui/ai/work-summary";

import { Steps } from "../session/transcript";
import { NoVercelTokenAlert } from "./failure-alerts";
import { FIRST_TURN_REPLY, FIRST_TURN_STEPS, REPLY_WORDS } from "./new-thread-data";
import { ENewThreadStage, isProvisioningStage } from "./new-thread-types";
import { PodReadyLine, Provisioning } from "./provisioning";

export interface NewThreadTranscriptProps {
  stage: ENewThreadStage;
  prompt: string;
  elapsed: number;
  visibleSteps: number;
  replyWords: number;
  onCancel: () => void;
  onRetry: () => void;
  onEditMessage: () => void;
  onOpenFile: (path: string) => void;
}

type TurnProps = Pick<NewThreadTranscriptProps, "stage" | "visibleSteps" | "replyWords" | "onOpenFile">;

function Turn({ stage, visibleSteps, replyWords, onOpenFile }: TurnProps) {
  const done = stage === ENewThreadStage.Idle;
  const reply = replyWords >= REPLY_WORDS.length ? FIRST_TURN_REPLY : REPLY_WORDS.slice(0, replyWords).join(" ");

  return (
    <div className="flex flex-col gap-4">
      <WorkSummary
        duration={done ? "9s" : `${Math.max(visibleSteps, 1)}s`}
        running={!done}
        defaultOpen
        stepCount={visibleSteps}
      >
        <Steps steps={FIRST_TURN_STEPS.slice(0, visibleSteps)} onOpenFile={onOpenFile} />
      </WorkSummary>
      {replyWords > 0 ? (
        <AgentMessage author="Atlas" timestamp="14:02" streaming={!done && replyWords < REPLY_WORDS.length}>
          {reply}
        </AgentMessage>
      ) : null}
    </div>
  );
}

function ProvisionBlock(props: NewThreadTranscriptProps) {
  const { stage } = props;
  if (stage === ENewThreadStage.NoVercelToken) return <NoVercelTokenAlert onRetry={props.onRetry} />;
  if (isProvisioningStage(stage) || stage === ENewThreadStage.ProvisionFailed) {
    return (
      <Provisioning
        stage={stage}
        elapsed={props.elapsed}
        onCancel={props.onCancel}
        onRetry={props.onRetry}
        onEditMessage={props.onEditMessage}
      />
    );
  }
  return <PodReadyLine elapsed={props.elapsed} />;
}

function EmptyTranscript() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">No messages yet. Send one to start a pod.</p>
    </div>
  );
}

export function NewThreadTranscript(props: NewThreadTranscriptProps) {
  if (props.stage === ENewThreadStage.Empty) return <EmptyTranscript />;
  const started = props.stage === ENewThreadStage.Streaming || props.stage === ENewThreadStage.Idle;

  return (
    <Chat className="min-h-0 flex-1">
      <ChatItem id="u1" anchor>
        <UserMessage author="Dennis" timestamp="14:02">
          {props.prompt}
        </UserMessage>
      </ChatItem>
      <ChatItem id="provision">
        <ProvisionBlock {...props} />
      </ChatItem>
      {started ? (
        <ChatItem id="turn">
          <Turn
            stage={props.stage}
            visibleSteps={props.visibleSteps}
            replyWords={props.replyWords}
            onOpenFile={props.onOpenFile}
          />
        </ChatItem>
      ) : null}
    </Chat>
  );
}
