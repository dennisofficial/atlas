import type { ReactNode } from 'react'

import { CodeBlock, CodeBlockContent } from '#components/code-block'
import { Trace } from '#components/trace'
import { Confirmation, EConfirmationState, type ConfirmationProps } from './confirmation'
import { EToolKind, TOOL_KINDS } from './internal/kinds'
import { Step } from './internal/step'

export { EToolKind }

export enum EToolState {
  Running = 'running',
  AwaitingApproval = 'awaiting-approval',
  Done = 'done',
  Error = 'error',
  Denied = 'denied',
}

export interface ToolProps {
  label: string
  title?: string | undefined
  kind?: EToolKind
  state?: EToolState
  output?: string
  errorText?: string
  elapsed?: string
  icon?: ReactNode
  children?: ReactNode
  defaultOpen?: boolean
  onApprove?: ConfirmationProps['onApprove']
  onDeny?: ConfirmationProps['onDeny']
}

interface ToolTitleInput {
  kind: EToolKind
  state: EToolState
  label: string
}

export function toolTitle({ kind, state, label }: ToolTitleInput): string {
  const verbs = TOOL_KINDS[kind]
  if (state === EToolState.Running) return `${verbs.running} ${label}`
  if (state === EToolState.Error) return `${verbs.error} ${label}`
  if (state === EToolState.Denied) return `Denied ${label}`
  if (state === EToolState.AwaitingApproval) return `${verbs.ask} ${label}?`
  return `${verbs.done} ${label}`
}

const STEP_STATUS = {
  [EToolState.Running]: 'running',
  [EToolState.Error]: 'error',
} as const

export function ToolLine({
  label,
  title,
  kind = EToolKind.Shell,
  state = EToolState.Done,
  output,
  errorText,
  elapsed,
  icon,
  children,
  defaultOpen,
}: ToolProps) {
  const Icon = TOOL_KINDS[kind].icon
  const failed = state === EToolState.Error
  const text = failed ? errorText : output
  const body =
    children ??
    (text ? (
      <CodeBlock size="sm">
        <CodeBlockContent wrap className="max-h-64">
          {text}
        </CodeBlockContent>
      </CodeBlock>
    ) : undefined)
  const status =
    state === EToolState.Running || state === EToolState.Error ? STEP_STATUS[state] : undefined

  return (
    <Step
      icon={icon ?? <Icon />}
      title={title ?? toolTitle({ kind, state, label })}
      description={elapsed}
      status={status}
      defaultOpen={defaultOpen ?? failed}
    >
      {state === EToolState.Running ? undefined : body}
    </Step>
  )
}

export function Tool(props: ToolProps) {
  const { state = EToolState.Done, kind = EToolKind.Shell } = props

  if (state === EToolState.AwaitingApproval) {
    const Icon = TOOL_KINDS[kind].icon
    return (
      <Confirmation
        icon={props.icon ?? <Icon />}
        title={props.title ?? toolTitle({ kind, state, label: props.label })}
        state={EConfirmationState.Pending}
        onApprove={props.onApprove}
        onDeny={props.onDeny}
      />
    )
  }

  return (
    <Trace>
      <ToolLine {...props} />
    </Trace>
  )
}
