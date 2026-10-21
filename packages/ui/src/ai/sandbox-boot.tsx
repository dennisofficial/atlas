"use client";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "#components/button";
import { Trace } from "#components/trace";
import {
  EStepStatus,
  Step,
  StatusIcon,
  StepLine,
  traceStatusOf,
} from "./internal/step";

export enum EBootStepState {
  Pending = "pending",
  Running = "running",
  Done = "done",
  Error = "error",
}

export interface SandboxBootStep {
  id: string;
  label: string;
  state: EBootStepState;
  detail?: string;
}

export interface SandboxBootProps {
  steps: SandboxBootStep[];
  state: EBootStepState;
  elapsedMs?: number;
  error?: string;
  onRetry?: () => void;
  className?: string;
}

const STEP_STATUS = {
  [EBootStepState.Pending]: EStepStatus.Pending,
  [EBootStepState.Running]: EStepStatus.Running,
  [EBootStepState.Done]: EStepStatus.Done,
  [EBootStepState.Error]: EStepStatus.Error,
} as const;

const TITLES = {
  [EBootStepState.Pending]: "Waiting for sandbox",
  [EBootStepState.Running]: "Starting sandbox",
  [EBootStepState.Done]: "Sandbox ready",
  [EBootStepState.Error]: "Sandbox failed to start",
} as const;

export function sandboxBootTitle(state: EBootStepState): string {
  return TITLES[state];
}

function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`;
}

type SandboxBootSummaryInput = Pick<
  SandboxBootProps,
  "steps" | "state" | "elapsedMs" | "error"
>;

export function sandboxBootSummary({
  steps,
  state,
  elapsedMs,
  error,
}: SandboxBootSummaryInput): string | undefined {
  if (state === EBootStepState.Error) {
    return error ?? steps.find((step) => step.state === EBootStepState.Error)?.label;
  }
  if (state === EBootStepState.Done) {
    return elapsedMs === undefined ? undefined : formatElapsed(elapsedMs);
  }
  if (state === EBootStepState.Pending) return undefined;
  const done = steps.filter((step) => step.state === EBootStepState.Done).length;
  const progress = `${done}/${steps.length}`;
  return elapsedMs === undefined
    ? progress
    : `${progress} · ${formatElapsed(elapsedMs)}`;
}

function BootStepLine({ step }: { step: SandboxBootStep }) {
  const status = STEP_STATUS[step.state];
  const failed = step.state === EBootStepState.Error;
  return (
    <StepLine
      icon={<StatusIcon status={status} />}
      title={step.label}
      description={
        step.detail && failed ? (
          <span className="text-destructive">{step.detail}</span>
        ) : (
          step.detail
        )
      }
      status={traceStatusOf(status)}
    />
  );
}

export function SandboxBoot({
  steps,
  state,
  elapsedMs,
  error,
  onRetry,
  className,
}: SandboxBootProps) {
  const status = STEP_STATUS[state];
  const open =
    state === EBootStepState.Running || state === EBootStepState.Error;
  const showRetry = state === EBootStepState.Error && onRetry !== undefined;

  return (
    <Trace data-slot="sandbox-boot" className={className}>
      <Step
        icon={<StatusIcon status={status} />}
        title={sandboxBootTitle(state)}
        description={sandboxBootSummary({ steps, state, elapsedMs, error })}
        status={traceStatusOf(status)}
        autoOpen={open}
        contentClassName="flex flex-col gap-2"
      >
        {steps.map((step) => (
          <BootStepLine key={step.id} step={step} />
        ))}
        {showRetry ? (
          <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>
            <RotateCcwIcon />
            Retry
          </Button>
        ) : null}
      </Step>
    </Trace>
  );
}
