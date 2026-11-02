import React, { useState } from 'react'

import {
  EControlOutcomeTone,
  EModelWaitAction,
  MODEL_WAIT_PARTIAL_NOTE,
  MODEL_WAIT_TITLE,
  RECHECK_CHARGE_WARNING,
  type ModelWaitIssue,
  type ModelWaitView,
} from '@dltech/atlas-client/transcript'

import { useClickRegion } from '../../hooks/use-click-region'
import { EKeyGroup, EKeyLayer, useKeyBindings } from '../../keys'
import {
  actionViewsOf,
  detailOf,
  hasProvidersAction,
  PROVIDERS_HINT,
  summaryOf,
  type ModelWaitControlAction,
  type ModelWaitControlState,
  type WaitActionView,
} from '../../model-wait-view'
import { wrapWords } from '../../text-flow'
import { ALT, glyph, theme, TRANSCRIPT_INSET } from '../../theme'
import { Panel, PANEL_INSET, PANEL_PAD } from '../panel'
import { Spans } from '../spans'
import type { Span } from '../spans'

const ACT_CHORD = 'meta+r'
const ACT_HINT = `${ALT}+r`

type Confirming = { key: string; action: ModelWaitControlAction }

function Control(props: {
  label: string
  hint?: string
  primary: boolean
  disabled: boolean
  onPress: () => void
}): React.ReactNode {
  const region = useClickRegion(props.disabled ? undefined : props.onPress)
  const spans: readonly Span[] = [
    {
      text: `${props.primary ? glyph.retry : glyph.marker} ${props.label}`,
      fg: props.disabled ? theme.hint : region.hovered ? theme.hover : theme.accent,
    },
    ...(props.hint === undefined || props.disabled
      ? []
      : [{ text: ` ${props.hint}`, fg: theme.hint }]),
  ]
  return (
    <text bg={region.hovered ? theme.hoverBg : theme.overlayBg} {...region.handlers}>
      <Spans spans={spans} />
    </text>
  )
}

function Issue(props: {
  issue: ModelWaitIssue
  cells: number
  open: boolean
  control: ModelWaitControlState
  confirming: Confirming | null
  primaryHint: boolean
  onTrigger: (issue: ModelWaitIssue, action: ModelWaitControlAction) => void
  onConfirm: () => void
  onCancel: () => void
}): React.ReactNode {
  const { issue, cells, control } = props
  const note = control.notes.get(issue.key)
  const actions = actionViewsOf({ issue, control })
  const confirming = props.confirming?.key === issue.key ? props.confirming : null
  return (
    <box flexDirection="column" flexShrink={0}>
      <text fg={theme.body} bg={theme.overlayBg}>
        {summaryOf({ issue, cells })}
      </text>
      {props.open ? (
        <text fg={theme.hint} bg={theme.overlayBg}>
          {detailOf({ issue, cells, labelOfThread: control.labelOfThread })}
        </text>
      ) : null}
      {note === undefined ? null : (
        <text
          fg={note.tone === EControlOutcomeTone.Error ? theme.error : theme.hint}
          bg={theme.overlayBg}
        >
          {wrapWords({ text: note.text, width: cells }).join('\n')}
        </text>
      )}
      {confirming === null ? (
        <box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={0}>
          {actions.map((view: WaitActionView) => (
            <Control
              key={view.action}
              label={view.label}
              primary={view.primary}
              disabled={view.blocked}
              {...(view.primary && props.primaryHint ? { hint: ACT_HINT } : {})}
              onPress={() => props.onTrigger(issue, view.action)}
            />
          ))}
          {hasProvidersAction(issue) ? (
            <text fg={theme.hint} bg={theme.overlayBg}>
              {PROVIDERS_HINT}
            </text>
          ) : null}
        </box>
      ) : (
        <box flexDirection="column" flexShrink={0}>
          <text fg={theme.warn} bg={theme.overlayBg}>
            {wrapWords({ text: RECHECK_CHARGE_WARNING, width: cells }).join('\n')}
          </text>
          <box flexDirection="row" columnGap={2} flexShrink={0}>
            <Control
              label="Recheck and continue"
              hint={ACT_HINT}
              primary
              disabled={false}
              onPress={props.onConfirm}
            />
            <Control
              label="Cancel"
              hint="esc"
              primary={false}
              disabled={false}
              onPress={props.onCancel}
            />
          </box>
        </box>
      )}
      {control.disabledReason !== undefined &&
      actions.some((view) => view.blocked && !view.pending) ? (
        <text fg={theme.hint} bg={theme.overlayBg}>
          {wrapWords({ text: control.disabledReason, width: cells }).join('\n')}
        </text>
      ) : null}
    </box>
  )
}

export function ModelWaitBlock(props: {
  view: ModelWaitView
  width: number
  control: ModelWaitControlState
}): React.ReactNode {
  const { view, control } = props
  const [open, setOpen] = useState(true)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  const panelWidth = Math.max(1, props.width - TRANSCRIPT_INSET)
  const cells = Math.max(10, panelWidth - PANEL_INSET - PANEL_PAD)
  const lead = view.issues[0]
  const leadAction = lead === undefined ? undefined : actionViewsOf({ issue: lead, control })[0]
  const toggle = useClickRegion(() => setOpen((current) => !current))

  const handleTrigger = (issue: ModelWaitIssue, action: ModelWaitControlAction) => {
    if (action === EModelWaitAction.Recheck) {
      setConfirming({ key: issue.key, action })
      return
    }
    control.onAction({ issue, action })
  }
  const handleConfirm = () => {
    const issue = view.issues.find((entry) => entry.key === confirming?.key)
    setConfirming(null)
    if (issue !== undefined) control.onAction({ issue, action: EModelWaitAction.Recheck })
  }
  const handleCancel = () => setConfirming(null)

  useKeyBindings([
    {
      chord: 'escape',
      hint: 'collapse',
      layer: EKeyLayer.Block,
      group: EKeyGroup.Turn,
      run: () => {
        if (confirming !== null) {
          setConfirming(null)
          return true
        }
        if (!open) return false
        setOpen(false)
        return true
      },
    },
    ...(lead === undefined || leadAction === undefined || leadAction.blocked
      ? []
      : [
          {
            chord: ACT_CHORD,
            hint: leadAction.label.toLowerCase(),
            layer: EKeyLayer.Block,
            group: EKeyGroup.Turn,
            run: () => {
              if (confirming !== null) handleConfirm()
              else handleTrigger(lead, leadAction.action)
            },
          },
        ]),
  ])

  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Panel
        rail={theme.warn}
        fill={theme.overlayBg}
        band={theme.panelBg}
        width={panelWidth}
        header={
          <>
            <text fg={theme.warn} bg={theme.panelBg}>{`${glyph.waiting} ${MODEL_WAIT_TITLE}`}</text>
            <box flexGrow={1} />
            <text
              fg={toggle.hovered ? theme.hover : theme.hint}
              bg={toggle.hovered ? theme.hoverBg : theme.panelBg}
              {...toggle.handlers}
            >
              {open ? 'hide details' : 'show details'}
            </text>
          </>
        }
      >
        {view.issues.map((issue) => (
          <Issue
            key={issue.key}
            issue={issue}
            cells={cells}
            open={open}
            control={control}
            confirming={confirming}
            primaryHint={issue.key === lead?.key}
            onTrigger={handleTrigger}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        ))}
        {view.partial ? (
          <text fg={theme.hint} bg={theme.overlayBg}>
            {wrapWords({ text: MODEL_WAIT_PARTIAL_NOTE, width: cells }).join('\n')}
          </text>
        ) : null}
      </Panel>
    </box>
  )
}
