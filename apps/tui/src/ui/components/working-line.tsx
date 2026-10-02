import React from 'react'

import { backgroundWaitLabel, type BackgroundWork } from '../background-wait'
import { useClickRegion } from '../hooks/use-click-region'
import { EKeyGroup, EKeyLayer, useKeyBindings } from '../keys'
import { retryLabel, type RetryWait } from '../retry-countdown'
import { formatElapsed, formatTokens, glyph, theme } from '../theme'
import { ShimmerLine, SpinnerGlyph } from './shimmer-line'

export enum EWorkingVerb {
  Working = 'Working',
  Thinking = 'Thinking',
  Compacting = 'Compacting',
  Reconnecting = 'Reconnecting',
  Waking = 'Waking the sandbox',
  Disconnected = 'Disconnected',
}

const INTERRUPTING = 'Interrupting…'

const lastSeenLabel = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function WorkingLine(props: {
  elapsedMs: number
  outputTokens: number
  interrupting: boolean
  verb?: EWorkingVerb | undefined
  retry?: RetryWait | null | undefined
  onReconnect?: (() => void) | undefined
  lastSeenAt?: number | null | undefined
}): React.ReactNode {
  const { retry } = props
  const onReconnect = props.verb === EWorkingVerb.Disconnected ? props.onReconnect : undefined
  useKeyBindings(onReconnect === undefined ? [] : [{
    chord: 'ctrl+r', hint: 'reconnect', layer: EKeyLayer.Block, group: EKeyGroup.Turn, run: onReconnect,
  }])
  const reconnect = useClickRegion(props.verb === EWorkingVerb.Disconnected ? props.onReconnect : undefined)

  if (retry !== null && retry !== undefined && !props.interrupting) {
    return (
      <box flexDirection="column">
        <ShimmerLine label={retryLabel({ retry, now: Date.now() })} base={theme.error} />
      </box>
    )
  }

  const verb = props.verb ?? EWorkingVerb.Working

  if (verb === EWorkingVerb.Disconnected) {
    return (
      <box flexDirection="column">
        <text {...reconnect.handlers} {...(reconnect.hovered ? { backgroundColor: theme.hoverBg } : {})}>
          <span fg={theme.warn}>○ disconnected — the turn may still be running</span>
          {props.lastSeenAt === null || props.lastSeenAt === undefined ? null : (
            <span fg={theme.dim}>{` · transcript last seen ${lastSeenLabel(props.lastSeenAt)}`}</span>
          )}
          {props.onReconnect === undefined ? null : (
            <>
              <span fg={theme.dim}>{'   '}</span>
              <span fg={theme.accent}>{`${glyph.retry} ctrl+r`}</span>
              <span fg={reconnect.hovered ? theme.hover : theme.hint}> reconnect</span>
            </>
          )}
        </text>
      </box>
    )
  }

  if (verb === EWorkingVerb.Reconnecting) {
    return (
      <box flexDirection="column">
        <ShimmerLine
          label={`Reconnecting for ${formatElapsed(props.elapsedMs)}`}
          base={theme.warn}
        />
      </box>
    )
  }

  if (verb === EWorkingVerb.Waking) {
    return (
      <box flexDirection="column">
        <ShimmerLine
          label={`Waking the sandbox for ${formatElapsed(props.elapsedMs)}`}
          base={theme.warn}
        />
      </box>
    )
  }

  if (props.interrupting) {
    return (
      <box flexDirection="column">
        <text fg={theme.dim}>
          <SpinnerGlyph fg={theme.accent} />
          {` ${INTERRUPTING}`}
        </text>
      </box>
    )
  }

  const tokens =
    props.outputTokens > 0 ? `↓ ${formatTokens(props.outputTokens)} tokens · ` : ''
  const label = `${verb} for ${formatElapsed(props.elapsedMs)} (${tokens}esc to interrupt)`

  return (
    <box flexDirection="column">
      <ShimmerLine label={label} />
    </box>
  )
}

/**
 * The complement of the working line, and never shown beside it: the turn has settled, but what it
 * started has not, so the transcript keeps a live row rather than looking finished while it isn't.
 *
 * `since` is when the wait began and is held by whoever outlives this line, because the transcript
 * unmounts whenever the operator opens a sub-agent: measured here, the reading would restart from
 * the moment they walked back in. The label is a function the shimmer resolves on every paint, so
 * the wait counts up on the shared ticker while nothing above re-renders — a settled turn ticks no
 * clock of its own.
 */
export function WaitingLine(props: {
  work: BackgroundWork
  since?: number | null
}): React.ReactNode {
  const since = props.since ?? null
  const label = (): string | null =>
    backgroundWaitLabel({
      work: props.work,
      ...(since === null ? {} : { waitedMs: Math.max(0, Date.now() - since) }),
    })
  if (label() === null) return null

  return (
    <box flexDirection="row" marginTop={1} marginBottom={1}>
      <ShimmerLine label={() => label() ?? ''} />
    </box>
  )
}
