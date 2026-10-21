import { CircleCheckIcon, CircleIcon, CircleXIcon, LoaderCircleIcon, RotateCcwIcon, ServerIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@dltech/atlas-ui/components/button";
import { Progress } from "@dltech/atlas-ui/components/progress";
import { Step, StepLine } from "@dltech/atlas-ui/ai/internal/step";
import { Trace } from "@dltech/atlas-ui/components/trace";

import {
  bootSummary,
  bootTitle,
  EBootState,
  overallProgress,
  type BootStepView,
  type BootView,
} from "./boot-simulation";

const TRACE_STATUS = {
  [EBootState.Running]: "running",
  [EBootState.Error]: "error",
  [EBootState.Pending]: "pending",
  [EBootState.Done]: undefined,
} as const;

function StateIcon({ state }: { state: EBootState }) {
  if (state === EBootState.Running) return <LoaderCircleIcon className="animate-spin" />;
  if (state === EBootState.Error) return <CircleXIcon className="text-destructive" />;
  if (state === EBootState.Pending) return <CircleIcon />;
  return <CircleCheckIcon />;
}

function RetryButton({ view }: { view: BootView }) {
  if (view.state !== EBootState.Error) return null;
  return (
    <Button variant="outline" size="sm" className="w-fit" onClick={view.replay}>
      <RotateCcwIcon />
      Retry
    </Button>
  );
}

export function ToolGroupVariant({ view }: { view: BootView }) {
  return (
    <Trace>
      <Step
        icon={<StateIcon state={view.state} />}
        title={bootTitle(view)}
        description={bootSummary(view)}
        status={TRACE_STATUS[view.state]}
        autoOpen={view.state !== EBootState.Done}
        contentClassName="flex flex-col gap-2"
      >
        {view.steps.map((step) => (
          <StepLine
            key={step.spec.id}
            icon={<StateIcon state={step.state} />}
            title={step.spec.label}
            description={step.detail}
            status={TRACE_STATUS[step.state]}
          />
        ))}
        <RetryButton view={view} />
      </Step>
    </Trace>
  );
}

function ProgressRow({ step }: { step: BootStepView }) {
  const failed = step.state === EBootState.Error;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="flex size-4 items-center justify-center text-muted-foreground [&_svg]:size-4">
          <StateIcon state={step.state} />
        </span>
        <span className={failed ? "text-destructive" : "text-foreground"}>{step.spec.label}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground tabular-nums">{step.detail}</span>
      </div>
      <Progress
        value={Math.round(step.progress * 100)}
        className={failed ? "[&_[data-slot=progress-indicator]]:bg-destructive" : undefined}
      />
    </div>
  );
}

export function ProgressCardVariant({ view }: { view: BootView }) {
  return (
    <section
      aria-label={bootTitle(view)}
      className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <header className="flex items-center gap-3">
        <span className="flex size-8 items-center justify-center rounded-md bg-muted [&_svg]:size-4">
          <ServerIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{bootTitle(view)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{bootSummary(view)}</span>
        </div>
        <span className="text-sm font-medium tabular-nums">{overallProgress(view)}%</span>
      </header>
      <div className="flex flex-col gap-3">
        {view.steps.map((step) => (
          <ProgressRow key={step.spec.id} step={step} />
        ))}
      </div>
      <RetryButton view={view} />
    </section>
  );
}

function Chip({ step }: { step: BootStepView }) {
  return (
    <span
      data-state={step.state}
      className="flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground data-[state=done]:text-foreground data-[state=error]:text-destructive [&_svg]:size-3"
    >
      <StateIcon state={step.state} />
      {step.spec.label}
    </span>
  );
}

export function LogTailVariant({ view }: { view: BootView }): ReactNode {
  const tail = view.logs.slice(-6);
  return (
    <Trace>
      <Step
        icon={<StateIcon state={view.state} />}
        title={bootTitle(view)}
        description={bootSummary(view)}
        status={TRACE_STATUS[view.state]}
        defaultOpen={false}
        contentClassName="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-1.5">
          {view.steps.map((step) => (
            <Chip key={step.spec.id} step={step} />
          ))}
        </div>
        <pre className="max-h-56 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {view.logs.join("\n")}
        </pre>
        <RetryButton view={view} />
      </Step>
      {view.state === EBootState.Running ? (
        <pre className="ml-6 font-mono text-xs text-muted-foreground/70">{tail.at(-1) ?? ""}</pre>
      ) : null}
    </Trace>
  );
}
