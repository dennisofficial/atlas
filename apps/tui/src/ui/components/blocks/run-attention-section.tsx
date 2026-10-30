import type { RunAttention } from '@dltech/atlas-client/transcript'
import React from 'react'

import type { TranscriptModel } from '../../../store'
import type { TurnClock } from '../../turn-clock'
import { ErrorBlock } from './error-block'
import { failureView, isResumeOnly } from './failure-text'
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
}): React.ReactNode {
  const { model, turn, onRetry, onDismiss, onResume } = props
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
  if (model.streaming || onResume === undefined || !isResumeOnly(props.attention)) return null
  return <ResumeBlock onResume={onResume} />
}
