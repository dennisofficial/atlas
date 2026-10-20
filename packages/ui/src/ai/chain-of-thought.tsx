import { Badge } from "#components/badge";
import { Trace } from "#components/trace";
import { hostnameOf } from "./sources";
import {
  EStepStatus,
  Step,
  StatusIcon,
  summarizeStatus,
  traceStatusOf,
} from "./internal/step";

export { EStepStatus };

export interface ChainOfThoughtStep {
  id: string;
  title: string;
  status?: EStepStatus;
  results?: string[];
}

export interface ChainOfThoughtProps {
  steps: ChainOfThoughtStep[];
  runningTitle?: string;
  doneTitle?: (count: number) => string;
  defaultOpen?: boolean;
}

function defaultDoneTitle(count: number): string {
  return `Researched in ${count} ${count === 1 ? "step" : "steps"}`;
}

export function ChainOfThought({
  steps,
  runningTitle = "Researching",
  doneTitle = defaultDoneTitle,
  defaultOpen,
}: ChainOfThoughtProps) {
  const status = summarizeStatus(
    steps.map((step) => step.status ?? EStepStatus.Done),
  );
  const running = status === EStepStatus.Running;
  const title = running ? runningTitle : doneTitle(steps.length);

  return (
    <Trace>
      <Step
        icon={<StatusIcon status={status} />}
        title={title}
        status={traceStatusOf(status)}
        autoOpen={defaultOpen === undefined ? running : undefined}
        defaultOpen={defaultOpen}
        keepMounted
      >
        <Trace>
          {steps.map((step) => (
            <Step
              key={step.id}
              icon={<StatusIcon status={step.status} />}
              title={step.title}
              status={traceStatusOf(step.status)}
              keepMounted
              contentClassName="flex flex-wrap gap-1.5"
            >
              {step.results?.length
                ? step.results.map((url) => (
                    <Badge key={url} variant="secondary">
                      {hostnameOf(url)}
                    </Badge>
                  ))
                : undefined}
            </Step>
          ))}
        </Trace>
      </Step>
    </Trace>
  );
}
