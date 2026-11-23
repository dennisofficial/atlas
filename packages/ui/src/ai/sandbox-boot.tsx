'use client'

import { RotateCcwIcon } from 'lucide-react'

import { Button } from '#components/button'
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '#components/code-block'
import { Trace } from '#components/trace'
import { EStepStatus, Step, StatusIcon, StepLine, traceStatusOf } from './internal/step'

export enum EBootStepState {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Error = 'error',
  Interrupted = 'interrupted',
}

export interface SandboxBootChild {
  id: string
  label: string
  state: EBootStepState
  detail?: string
}

export interface SandboxBootStep {
  id: string
  label: string
  state: EBootStepState
  detail?: string
  children?: SandboxBootChild[]
  command?: string
  output?: string
}

export interface SandboxBootProps {
  steps: SandboxBootStep[]
  state: EBootStepState
  title?: string
  elapsedMs?: number
  error?: string
  onRetry?: () => void
  className?: string
}

const STEP_STATUS = {
  [EBootStepState.Pending]: EStepStatus.Pending,
  [EBootStepState.Running]: EStepStatus.Running,
  [EBootStepState.Done]: EStepStatus.Done,
  [EBootStepState.Error]: EStepStatus.Error,
  [EBootStepState.Interrupted]: EStepStatus.Running,
} as const

const TITLES = {
  [EBootStepState.Pending]: 'Waiting for sandbox',
  [EBootStepState.Running]: 'Starting sandbox',
  [EBootStepState.Done]: 'Sandbox ready',
  [EBootStepState.Error]: 'Sandbox failed to start',
  [EBootStepState.Interrupted]: 'Setup restarted · running again',
} as const

const ERROR_LABEL = 'Sandbox'

export function sandboxBootTitle(state: EBootStepState): string {
  return TITLES[state]
}

function formatElapsed(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

type SandboxBootSummaryInput = Pick<SandboxBootProps, 'steps' | 'state' | 'elapsedMs'>

export function sandboxBootSummary({
  steps,
  state,
  elapsedMs,
}: SandboxBootSummaryInput): string | undefined {
  if (state === EBootStepState.Error || state === EBootStepState.Pending) return undefined
  if (state === EBootStepState.Done) {
    return elapsedMs === undefined ? undefined : formatElapsed(elapsedMs)
  }
  const done = steps.filter((step) => step.state === EBootStepState.Done).length
  const progress = `${done}/${steps.length}`
  return elapsedMs === undefined ? progress : `${progress} · ${formatElapsed(elapsedMs)}`
}

const errorTextOf = (step: SandboxBootChild): string | undefined =>
  step.state === EBootStepState.Error ? step.detail : undefined

function BootErrorCard({ text, className }: { text: string; className?: string }) {
  return (
    <div data-slot="sandbox-boot-error" className={className}>
      <CodeBlock size="sm">
        <CodeBlockHeader>
          <CodeBlockTitle>{ERROR_LABEL}</CodeBlockTitle>
        </CodeBlockHeader>
        <CodeBlockContent wrap className="max-h-64">
          {text}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}

function BootLine({ step }: { step: SandboxBootChild }) {
  const status = STEP_STATUS[step.state]
  return (
    <StepLine
      icon={<StatusIcon status={status} />}
      title={step.label}
      description={errorTextOf(step) === undefined ? step.detail : undefined}
      status={traceStatusOf(status)}
    />
  )
}

function BootRow({ step }: { step: SandboxBootChild }) {
  const error = errorTextOf(step)
  return (
    <div className="flex flex-col gap-1">
      <BootLine step={step} />
      {error === undefined ? null : <BootErrorCard text={error} />}
    </div>
  )
}

function BootTerminal({ command, output }: { command: string; output?: string }) {
  const text = output === undefined || output === '' ? `$ ${command}` : `$ ${command}\n${output}`
  return (
    <div data-slot="sandbox-boot-terminal" className="pl-6">
      <CodeBlock size="sm">
        <CodeBlockContent wrap className="max-h-64">
          {text}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  )
}

function BootStepLine({ step }: { step: SandboxBootStep }) {
  const error = errorTextOf(step)
  const children = step.children ?? []
  return (
    <div className="flex flex-col gap-1">
      <BootLine step={step} />
      {error === undefined ? null : <BootErrorCard text={error} className="pl-6" />}
      {children.length === 0 ? null : (
        <div data-slot="sandbox-boot-children" className="flex flex-col gap-1 pl-6">
          {children.map((child) => (
            <BootRow key={child.id} step={child} />
          ))}
        </div>
      )}
      {step.command === undefined ? null : (
        <BootTerminal command={step.command} output={step.output} />
      )}
    </div>
  )
}

const carriesError = (step: SandboxBootStep): boolean =>
  errorTextOf(step) !== undefined ||
  (step.children ?? []).some((child) => errorTextOf(child) !== undefined)

export function SandboxBoot({
  steps,
  state,
  title,
  elapsedMs,
  error,
  onRetry,
  className,
}: SandboxBootProps) {
  const status = STEP_STATUS[state]
  const open =
    state === EBootStepState.Running ||
    state === EBootStepState.Interrupted ||
    state === EBootStepState.Error ||
    steps.some(carriesError)
  const showRetry = state === EBootStepState.Error && onRetry !== undefined
  const headerError =
    state === EBootStepState.Error && error !== undefined && !steps.some(carriesError)
      ? error
      : undefined

  return (
    <Trace data-slot="sandbox-boot" className={className}>
      <Step
        icon={<StatusIcon status={status} />}
        title={title ?? sandboxBootTitle(state)}
        description={sandboxBootSummary({ steps, state, elapsedMs })}
        status={traceStatusOf(status)}
        autoOpen={open}
        contentClassName="flex flex-col gap-2"
      >
        {headerError === undefined ? null : <BootErrorCard text={headerError} />}
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
  )
}
