import type { ReactNode } from "react";
import { CircleCheckIcon, CircleIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";

import { Button } from "@dltech/atlas-ui/components/button";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@dltech/atlas-ui/components/trace";

import { POD_STAGES, PROVISION_FAILURE_DETAIL, type PodStage } from "./new-thread-data";
import { EPodProgress } from "./new-thread-types";

export interface ProvisioningProps {
  pod: EPodProgress;
  elapsed: number;
  onRetry: () => void;
}

enum ERowState {
  Done = "done",
  Active = "active",
  Pending = "pending",
  Failed = "failed",
}

function rowState({ index, pod }: { index: number; pod: EPodProgress }): ERowState {
  if (pod === EPodProgress.ProvisionFailed) return index === 0 ? ERowState.Failed : ERowState.Pending;
  const current = POD_STAGES.findIndex((entry) => entry.pod === pod);
  if (index < current) return ERowState.Done;
  return index === current ? ERowState.Active : ERowState.Pending;
}

const ROW_ICON: Record<ERowState, ReactNode> = {
  [ERowState.Done]: <CircleCheckIcon className="text-success" />,
  [ERowState.Active]: <LoaderCircleIcon className="animate-spin" />,
  [ERowState.Pending]: <CircleIcon />,
  [ERowState.Failed]: <CircleXIcon />,
};

const ROW_STATUS = {
  [ERowState.Done]: undefined,
  [ERowState.Active]: "running",
  [ERowState.Pending]: "pending",
  [ERowState.Failed]: "error",
} as const;

function StageRow({ entry, state }: { entry: PodStage; state: ERowState }) {
  return (
    <li className="flex flex-col gap-1">
      <TraceLine status={ROW_STATUS[state]} className={state === ERowState.Active ? "text-foreground" : undefined}>
        <TraceIcon>{ROW_ICON[state]}</TraceIcon>
        <TraceTitle>{entry.label}</TraceTitle>
      </TraceLine>
      {state === ERowState.Failed ? (
        <p className="pl-6 font-mono text-xs text-destructive/90">{PROVISION_FAILURE_DETAIL}</p>
      ) : null}
    </li>
  );
}

export function PodReadyLine({ elapsed }: { elapsed: number }) {
  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <CircleCheckIcon className="text-success" />
        </TraceIcon>
        <TraceTitle>Pod ready</TraceTitle>
        <TraceDescription>· {elapsed}s</TraceDescription>
      </TraceLine>
    </Trace>
  );
}

export function Provisioning({ pod, elapsed, onRetry }: ProvisioningProps) {
  const failed = pod === EPodProgress.ProvisionFailed;

  return (
    <section
      aria-label="Pod provisioning"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      <header className="flex h-6 items-center gap-2 text-sm">
        <span className="font-medium">{failed ? "Couldn't start a pod" : "Starting a pod"}</span>
        <span className="text-xs text-muted-foreground">on Vercel</span>
        <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">{elapsed}s</span>
      </header>
      <ol className="flex flex-col gap-2">
        {POD_STAGES.map((entry, index) => (
          <StageRow key={entry.pod} entry={entry} state={rowState({ index, pod })} />
        ))}
      </ol>
      {failed ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </section>
  );
}
