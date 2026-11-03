import {
  choiceOptionsOf,
  ESettingId,
  ESettingKind,
  parseUnifiedDiff,
  type DiffFile,
  type ResolvedSetting,
  type SettingsResolution,
} from '@dltech/atlas-core'
import React from 'react'

import { accentHex } from '../../accents'
import type { Appearance } from '../../appearance'
import { useDraft } from '../../hooks/use-draft'
import { logoCells, logoHasNarrowLabel } from '../../logo'
import { FencedBlock } from '../../markdown/fenced-block'
import { theme } from '../../theme'
import { Composer, EComposerTone } from '../composer'
import { InlineDiff } from '../diff/inline-diff'
import { LogoRows, NarrowLogo } from '../logo-rows'

export type SettingPreview = {
  render: (args: {
    width: number
    appearance: Appearance
    setting: ResolvedSetting
    resolution: SettingsResolution
  }) => React.ReactNode
}

export const CHOSEN = '●'

export const UNCHOSEN = '○'

const namesOf = (args: {
  setting: ResolvedSetting
  resolution: SettingsResolution
}): readonly string[] =>
  args.setting.definition.kind === ESettingKind.Choice
    ? choiceOptionsOf({
        definition: args.setting.definition,
        resolution: args.resolution,
      }).map((option) => option.value)
    : []

function Swatches(props: {
  chosen: string
  setting: ResolvedSetting
  resolution: SettingsResolution
}): React.ReactNode {
  return (
    <box flexDirection="row" flexShrink={0} gap={2}>
      {namesOf({ setting: props.setting, resolution: props.resolution }).map((name) => (
        <text key={name} fg={name === props.chosen ? accentHex(name) : theme.dim}>
          {`${name === props.chosen ? CHOSEN : UNCHOSEN} ${name}`}
        </text>
      ))}
    </box>
  )
}

export const DIFF_PATH = 'src/ui/theme.ts'

const FENCE_LANGUAGE = 'ts'

const FENCE = ['const rail = theme.accent', 'const fill = theme.panelBg'].join('\n')

const PATCH = [
  `diff --git a/${DIFF_PATH} b/${DIFF_PATH}`,
  `--- a/${DIFF_PATH}`,
  `+++ b/${DIFF_PATH}`,
  '@@ -11,6 +11,6 @@ export const theme: Palette = {',
  "   appBg: '#282422',",
  '-  accent: ACCENT,',
  '+  accent: accentHex(chosen),',
  "   dim: '#6b625c',",
].join('\n')

const DENSITY_DIFF: DiffFile | undefined = parseUnifiedDiff(PATCH)[0]

export const COMPOSER_DRAFT = 'the draft, edged the way you picked'

const COMPOSER_ROWS = 2

function ComposerScene(props: { width: number }): React.ReactNode {
  const draft = useDraft()

  return (
    <Composer
      draft={draft}
      width={props.width}
      tone={EComposerTone.Idle}
      placeholder={COMPOSER_DRAFT}
      maxRows={COMPOSER_ROWS}
      focused={false}
    />
  )
}

function LogoScene(props: { appearance: Appearance; width: number }): React.ReactNode {
  const chosen = props.appearance.logo
  if (props.width >= logoCells(chosen)) return <LogoRows logo={chosen} />
  return logoHasNarrowLabel(chosen) ? <NarrowLogo /> : null
}

const PREVIEWS: Readonly<Record<string, SettingPreview>> = {
  [ESettingId.Accent]: {
    render: ({ appearance, setting, resolution }) => (
      <Swatches chosen={appearance.accent} setting={setting} resolution={resolution} />
    ),
  },
  [ESettingId.ComposerEdge]: {
    render: ({ width }) => <ComposerScene width={width} />,
  },
  [ESettingId.Logo]: {
    render: ({ appearance, width }) => <LogoScene appearance={appearance} width={width} />,
  },
  [ESettingId.BlockPadding]: {
    render: ({ width }) => (
      <box flexDirection="column" flexShrink={0} gap={1}>
        <FencedBlock language={FENCE_LANGUAGE} filename="theme.ts" source={FENCE} width={width} />
        {DENSITY_DIFF === undefined ? null : <InlineDiff file={DENSITY_DIFF} width={width} />}
      </box>
    ),
  },
}

export const previewFor = (id: string): SettingPreview | undefined => PREVIEWS[id]
