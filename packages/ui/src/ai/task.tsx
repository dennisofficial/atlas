import { Trace } from "#components/trace";
import { EToolKind, TOOL_KINDS } from "./internal/kinds";
import {
  EStepStatus,
  Step,
  StepLine,
  StepLink,
  traceStatusOf,
} from "./internal/step";

export { EStepStatus, EToolKind };

export interface TaskStep {
  id: string;
  kind: EToolKind;
  label: string;
  status?: EStepStatus;
  href?: string;
}

export interface TaskProps {
  title: string;
  steps: TaskStep[];
  status?: EStepStatus;
  defaultOpen?: boolean;
}

export function stepTitle(step: TaskStep): string {
  const verbs = TOOL_KINDS[step.kind];
  if (step.status === EStepStatus.Running) return `${verbs.running} ${step.label}`;
  if (step.status === EStepStatus.Error) return `${verbs.error} ${step.label}`;
  return `${verbs.done} ${step.label}`;
}

function TaskStepLine({ step }: { step: TaskStep }) {
  const Icon = TOOL_KINDS[step.kind].icon;
  const line = {
    icon: <Icon />,
    title: stepTitle(step),
    status: traceStatusOf(step.status),
  };
  if (step.href) return <StepLink href={step.href} {...line} />;
  return <StepLine {...line} />;
}

export function Task({
  title,
  steps,
  status = EStepStatus.Done,
  defaultOpen,
}: TaskProps) {
  return (
    <Trace>
      <Step
        title={title}
        status={traceStatusOf(status)}
        defaultOpen={defaultOpen ?? status === EStepStatus.Running}
        keepMounted
      >
        <Trace>
          {steps.map((step) => (
            <TaskStepLine key={step.id} step={step} />
          ))}
        </Trace>
      </Step>
    </Trace>
  );
}
