import { Chat, ChatItem } from "@dltech/atlas-ui/ai/chat";
import { Confirmation, EConfirmationState } from "@dltech/atlas-ui/ai/confirmation";
import { AgentMessage, UserMessage } from "@dltech/atlas-ui/ai/message";
import { Reasoning } from "@dltech/atlas-ui/ai/reasoning";
import { EToolKind, EToolState, Tool, ToolLine } from "@dltech/atlas-ui/ai/tool";
import { WorkSummary } from "@dltech/atlas-ui/ai/work-summary";
import { Trace } from "@dltech/atlas-ui/components/trace";

import { ESessionState } from "./session-types";
import {
  FIRST_PROMPT,
  FIRST_TURN_REASONING,
  FIRST_TURN_STEPS,
  SECOND_PROMPT,
  SECOND_TURN_DURATION,
  SECOND_TURN_STEPS,
  type StepSpec,
} from "./transcript-data";

export interface TranscriptProps {
  state: ESessionState;
  approval: EConfirmationState;
  onApprove: () => void;
  onDeny: () => void;
  onOpenFile: (path: string) => void;
}

interface StepsProps {
  steps: StepSpec[];
  onOpenFile: (path: string) => void;
}

function EditStep({ step, onOpenFile }: { step: StepSpec; onOpenFile: (path: string) => void }) {
  const handleClick = () => onOpenFile(step.label);

  return (
    <Trace>
      <button
        type="button"
        aria-label={`Open ${step.label} in Changes`}
        onClick={handleClick}
        className="w-fit max-w-full rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ToolLine kind={EToolKind.Edit} label={step.label} elapsed={step.elapsed} />
      </button>
    </Trace>
  );
}

function Steps({ steps, onOpenFile }: StepsProps) {
  return (
    <>
      {steps.map((step) =>
        step.kind === EToolKind.Edit ? (
          <EditStep key={step.id} step={step} onOpenFile={onOpenFile} />
        ) : (
          <Tool
            key={step.id}
            kind={step.kind}
            label={step.label}
            state={step.state ?? EToolState.Done}
            output={step.output}
            errorText={step.errorText}
            elapsed={step.elapsed}
          />
        ),
      )}
    </>
  );
}

function FirstTurn({ onOpenFile }: Pick<TranscriptProps, "onOpenFile">) {
  return (
    <ChatItem id="a1">
      <div className="flex flex-col gap-4">
        <WorkSummary duration="33m" stepCount={FIRST_TURN_STEPS.length + 1}>
          <Reasoning text={FIRST_TURN_REASONING} duration="9s" />
          <Steps steps={FIRST_TURN_STEPS} onOpenFile={onOpenFile} />
        </WorkSummary>
        <AgentMessage author="Atlas" timestamp="14:35">
          <p>
            The theme now generates from <code className="font-mono text-[0.85em]">src/tokens</code>, so
            the CSS and the tokens cannot drift. Three things changed:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Semantic tokens map onto the shadcn variable names, with our colors kept.</li>
            <li>
              <code className="font-mono text-[0.85em]">theme.css</code> is regenerated, including the
              diff add and remove surfaces.
            </li>
            <li>The diff viewer uses the new gutter and word-highlight tokens.</li>
          </ul>
          <p className="mt-2">Typecheck and the ui specs are still to run.</p>
        </AgentMessage>
      </div>
    </ChatItem>
  );
}

function SecondTurn({ state, approval, onApprove, onDeny, onOpenFile }: TranscriptProps) {
  const steps = SECOND_TURN_STEPS[state];
  const running = state === ESessionState.Running;
  const idle = state === ESessionState.Idle;

  return (
    <ChatItem id="a2">
      <div className="flex flex-col gap-4">
        <WorkSummary
          duration={SECOND_TURN_DURATION[state]}
          running={running}
          defaultOpen={idle ? false : true}
          stepCount={steps.length}
        >
          <Steps steps={steps} onOpenFile={onOpenFile} />
        </WorkSummary>
        {idle ? (
          <AgentMessage author="Atlas" timestamp="14:49">
            Typecheck and the ui specs pass, the legacy home page is gone, and the draft PR is open:
            dennisofficial/atlas#1316. The theme.css diff is large because it is generated.
          </AgentMessage>
        ) : null}
        {state === ESessionState.ApprovalPending ? (
          <>
            <AgentMessage author="Atlas" timestamp="14:43">
              Typecheck failed on the new tool pattern. Before I clean the generated output, I need your
              go-ahead.
            </AgentMessage>
            <Confirmation
              title="Run rm -rf node_modules?"
              description="Reinstalling takes about a minute."
              evidence={["matched rule: recursive delete"]}
              state={approval}
              onApprove={onApprove}
              onDeny={onDeny}
            />
          </>
        ) : null}
      </div>
    </ChatItem>
  );
}

export function Transcript(props: TranscriptProps) {
  return (
    <Chat className="min-h-0 flex-1">
      <ChatItem id="u1" anchor>
        <UserMessage author="Dennis" timestamp="14:02">
          {FIRST_PROMPT}
        </UserMessage>
      </ChatItem>
      <FirstTurn onOpenFile={props.onOpenFile} />
      <ChatItem id="u2">
        <UserMessage author="Dennis" timestamp="14:36">
          {SECOND_PROMPT}
        </UserMessage>
      </ChatItem>
      <SecondTurn {...props} />
    </Chat>
  );
}
