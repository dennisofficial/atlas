import type { RunAttention } from '@dltech/atlas-client/transcript'
import React from 'react'

import type { TranscriptModel } from '../../../store'
import type { TurnClock } from '../../turn-clock'
import type { ModelWaitControlState } from '../../model-wait-view'
import { ErrorBlock } from './error-block'
import { agentFailureView, failureView, isAgentFailed, isResumeOnly } from './failure-text'
import { ModelWaitBlock } from './model-wait-block'
import { ResumeBlock } from './resume-block'

export function RunAttentionSection(props: {
  model: TranscriptModel
  turn: TurnClock
  width: number
  attention: RunAttention | null
  accountLabel: string | undefined
  onRetry: (() => void) | undefined
  onDismiss: (() => void) | undefined
  onResume: (() => void) | undefined
  modelWait?: ModelWaitControlState | undefined
}): React.ReactNode {
  const { model, turn, onRetry, onDismiss, onResume } = props
  const waiting = props.attention?.modelWait ?? null
  if (waiting !== null && props.modelWait !== undefined) {
    return <ModelWaitBlock view={waiting} width={props.width} control={props.modelWait} />
  }
  if (model.failure !== null) {
    return (
      <ErrorBlock
        {...failureView({
          failure: model.failure,
          attention: props.attention,
          accountLabel: props.accountLabel,
        })}
        width={props.width}
        {...(turn.completed === null
          ? {}
          : { durationMs: turn.completed.durationMs, outputTokens: turn.completed.outputTokens })}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(onDismiss === undefined ? {} : { onDismiss })}
      />
    )
  }
  if (model.streaming) return null
  if (props.attention !== null && isAgentFailed(props.attention)) {
    return (
      <ErrorBlock
        {...agentFailureView(props.attention)}
        width={props.width}
        {...(onDismiss === undefined ? {} : { onDismiss })}
      />
    )
  }
  if (onResume === undefined || !isResumeOnly(props.attention)) return null
  return <ResumeBlock onResume={onResume} {...(onDismiss === undefined ? {} : { onDismiss })} />
}
