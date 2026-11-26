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
import { bootStepErrorOf, EBootStepState, sandboxBootDisplayOf } from './sandbox-boot-copy'

export {
  bootStepErrorOf,
  EBootStepState,
  sandboxBootDisplayOf,
  sandboxBootSummary,
  sandboxBootTitle,
} from './sandbox-boot-copy'

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

const ERROR_LABEL = 'Sandbox'

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
      description={bootStepErrorOf(step) === undefined ? step.detail : undefined}
      status={traceStatusOf(status)}
    />
  )
}

function BootRow({ step }: { step: SandboxBootChild }) {
  const error = bootStepErrorOf(step)
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
  const error = bootStepErrorOf(step)
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
  const display = sandboxBootDisplayOf({ steps, state, title, elapsedMs, error })
  const showRetry = display.failed && onRetry !== undefined

  return (
    <Trace data-slot="sandbox-boot" className={className}>
      <Step
        icon={<StatusIcon status={status} />}
        title={display.title}
        description={display.summary}
        status={traceStatusOf(status)}
        autoOpen={display.open}
        contentClassName="flex flex-col gap-2"
      >
        {display.headerError === undefined ? null : <BootErrorCard text={display.headerError} />}
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
