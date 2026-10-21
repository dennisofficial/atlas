import React from 'react'

import { EHarnessPlacement, ERunner } from '@dltech/atlas-core'

import { modelLabel } from '../model-label'
import { collapseHome } from '../paths'
import { theme } from '../theme'
import { wordmarkRows, WORDMARK_CELLS } from '../wordmark'
import { Spans } from './spans'

const PITCH = 'A coding agent working in this directory.'

const ACTION = 'Describe the work below.'

const SEPARATOR = ' · '

const HOST_LABEL = '☁ local'

const CLOUD_LABEL = '☁ cloud'

const HOST_HINT = '↓ to the footer chip, ⏎ for a pod'

const CLOUD_HINT = '↓ to the footer chip, ⏎ to switch runner'

export type WelcomePlacement = { harness: EHarnessPlacement; runner?: ERunner | undefined; provisioning: boolean }

const POD_LABEL = 'pod'

const placedLabelOf = (placement: WelcomePlacement | null | undefined): string =>
  placement?.runner === ERunner.Local ? POD_LABEL : CLOUD_LABEL

export function WelcomeScreen(props: {
  cwd: string
  home: string
  modelId: string
  version: string
  width: number
  shape?: 'chip' | 'hero'
  placement?: WelcomePlacement | null
}): React.ReactNode {
  const marked = props.width >= WORDMARK_CELLS
  const hosted =
    marked && props.shape === 'hero' && props.placement != null
      ? props.placement.harness === EHarnessPlacement.Host
      : null
  const rows = wordmarkRows({ accent: theme.accent, ground: theme.appBg, bright: theme.bright })

  return (
    <box flexDirection="column" flexShrink={0} alignItems="center">
      {marked ? (
        <box flexDirection="column" flexShrink={0} width={WORDMARK_CELLS}>
          {rows.map((row, index) => (
            <box key={index} height={1} flexShrink={0}>
              <text>
                <Spans spans={row} />
              </text>
            </box>
          ))}
        </box>
      ) : null}
      <text> </text>
      <text fg={theme.meta}>{PITCH}</text>
      <text> </text>
      <text>
        <span fg={theme.hint}>{collapseHome({ cwd: props.cwd, home: props.home })}</span>
        <span fg={theme.rule}>{SEPARATOR}</span>
        <span fg={theme.hint}>{modelLabel(props.modelId)}</span>
        <span fg={theme.rule}>{SEPARATOR}</span>
        <span fg={theme.hint}>{props.version}</span>
        {hosted === null ? null : (
          <>
            <span fg={theme.rule}>{SEPARATOR}</span>
            <span fg={theme.meta}>{hosted ? HOST_LABEL : placedLabelOf(props.placement)}</span>
          </>
        )}
      </text>
      <text> </text>
      <text fg={theme.meta}>{ACTION}</text>
      {hosted === null ? null : (
        <text>
          <span fg={theme.hint}>{hosted ? HOST_HINT : CLOUD_HINT}</span>
        </text>
      )}
      <text> </text>
    </box>
  )
}
