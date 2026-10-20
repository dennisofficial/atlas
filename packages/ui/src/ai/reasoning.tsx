import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";

import { Trace } from "#components/trace";
import { Step } from "./internal/step";

export interface ReasoningProps {
  text: string;
  running?: boolean;
  duration?: string;
  defaultOpen?: boolean;
}

export function Reasoning({
  text,
  running = false,
  duration,
  defaultOpen,
}: ReasoningProps) {
  return (
    <Trace>
      <Step
        icon={
          running ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <CircleCheckIcon />
          )
        }
        title={running ? "Thinking" : "Thought"}
        description={running ? undefined : duration}
        status={running ? "running" : undefined}
        autoOpen={defaultOpen === undefined ? running : undefined}
        defaultOpen={defaultOpen}
        contentClassName="whitespace-pre-wrap"
      >
        {text.length > 0 ? text : undefined}
      </Step>
    </Trace>
  );
}
