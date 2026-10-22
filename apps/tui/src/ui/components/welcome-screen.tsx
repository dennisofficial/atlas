import React from 'react'

import { EHarnessPlacement, ERunner } from '@dltech/atlas-core'

import { useAppearance } from '../hooks/use-appearance'
import { logoCells, logoHasNarrowLabel } from '../logo'
import { logo } from '../logo-store'
import { modelLabel } from '../model-label'
import { collapseHome } from '../paths'
import { theme } from '../theme'
import { LogoRows, NarrowLogo } from './logo-rows'

const PITCH = 'A coding agent working in this directory.'

const ACTION = 'Describe the work below.'

const SEPARATOR = ' · '

const HOST_LABEL = '☁ local'

const CLOUD_LABEL = '☁ cloud'

const HOST_HINT = '↓ to the footer chip, ⏎ for a pod'

const CLOUD_HINT = '↓ to the footer chip, ⏎ to switch runner'

export type WelcomePlacement = {
  harness: EHarnessPlacement
  runner?: ERunner | undefined
  provisioning: boolean
}

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
  useAppearance()
  const chosen = logo()
  const marked = props.width >= logoCells(chosen)
  const hosted =
    marked && props.shape === 'hero' && props.placement != null
      ? props.placement.harness === EHarnessPlacement.Host
      : null

  return (
    <box flexDirection="column" flexShrink={0} alignItems="center">
      {marked ? <LogoRows logo={chosen} /> : logoHasNarrowLabel(chosen) ? <NarrowLogo /> : null}
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
