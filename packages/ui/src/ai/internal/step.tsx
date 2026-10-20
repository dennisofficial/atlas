"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import {
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  LoaderCircleIcon,
} from "lucide-react";

import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "#components/trace";

export enum EStepStatus {
  Pending = "pending",
  Running = "running",
  Done = "done",
  Error = "error",
}

type TraceStatus = "running" | "error" | "pending" | undefined;

export function traceStatusOf(status: EStepStatus | undefined): TraceStatus {
  if (status === EStepStatus.Running) return "running";
  if (status === EStepStatus.Error) return "error";
  if (status === EStepStatus.Pending) return "pending";
  return undefined;
}

export function summarizeStatus(statuses: EStepStatus[]): EStepStatus {
  if (statuses.includes(EStepStatus.Running)) return EStepStatus.Running;
  if (statuses.includes(EStepStatus.Error)) return EStepStatus.Error;
  return EStepStatus.Done;
}

export interface StatusIconProps {
  status: EStepStatus | undefined;
  doneIcon?: ReactNode;
}

export function StatusIcon({ status, doneIcon }: StatusIconProps) {
  if (status === EStepStatus.Running) {
    return <LoaderCircleIcon className="animate-spin" />;
  }
  if (status === EStepStatus.Error) return <CircleXIcon />;
  if (status === EStepStatus.Pending) return <CircleIcon />;
  return doneIcon ?? <CircleCheckIcon />;
}

export interface StepLineProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: TraceStatus;
  trailing?: ReactNode;
}

export function StepLine({
  icon,
  title,
  description,
  status,
  trailing,
}: StepLineProps) {
  return (
    <TraceLine status={status}>
      {icon ? <TraceIcon>{icon}</TraceIcon> : null}
      <TraceTitle>{title}</TraceTitle>
      {description ? <TraceDescription>{description}</TraceDescription> : null}
      {trailing ? <TraceIcon>{trailing}</TraceIcon> : null}
    </TraceLine>
  );
}

export interface StepLinkProps extends StepLineProps {
  href: string;
}

export function StepLink({ href, ...line }: StepLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <StepLine {...line} />
    </a>
  );
}

export interface StepProps extends StepLineProps {
  children?: ReactNode;
  defaultOpen?: boolean;
  autoOpen?: boolean;
  keepMounted?: boolean;
  contentClassName?: string;
}

export function Step({
  children,
  defaultOpen,
  autoOpen,
  keepMounted,
  contentClassName,
  ...line
}: StepProps) {
  const [userOpen, setUserOpen] = useState<boolean>();
  const handleOpenChange = (open: boolean) => setUserOpen(open);

  if (children === undefined || children === null || children === false) {
    return <StepLine {...line} />;
  }

  const body = (
    <>
      <TraceCollapsibleTrigger>
        <StepLine {...line} />
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent
        keepMounted={keepMounted}
        className={contentClassName}
      >
        {children}
      </TraceCollapsibleContent>
    </>
  );

  if (autoOpen === undefined) {
    return <TraceCollapsible defaultOpen={defaultOpen}>{body}</TraceCollapsible>;
  }

  return (
    <TraceCollapsible
      open={userOpen ?? autoOpen}
      onOpenChange={handleOpenChange}
    >
      {body}
    </TraceCollapsible>
  );
}
