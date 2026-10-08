import { ATLAS_SETTINGS, ESettingId, ESettingsLayer, resolveSettings, toThreadId, type SecretPrompt, type SettingDefinition, type SettingsLayerInput, type TextPrompt } from '@dltech/atlas-core'
import React from 'react'
import { Settings } from '../components/settings'
import { EQualityHealthReadKind } from '../../composition/use-quality-health'
import { ECloudAction, idleSync } from '../components/settings/cloud'
import { type Span } from '../components/spans'
import { grammarsReady } from '../markdown/__tests__/harness'
import { SHIPPED_ACCENT, type Appearance } from '../appearance'
import { SHIPPED_IMAGE_ROWS } from '../image-rows-store'
import { SHIPPED_FENCE_WRAP } from '../fence-wrap-store'
import { EComposerEdge } from '../composer-edge-store'
import { EBlockDensity } from '../density-store'
import { idleLogin } from '../settings-login-model'
import { settingsModel, type SettingsState, type ShadowedAgentTypeSource } from '../settings-model'
import { SIDEBAR_WIDTH } from '../theme'
import { frameOf } from './transcript-fixture'

await grammarsReady()

export const WIDE = 120

export const NARROW = 88

export const ORIGIN = '~/.atlas/settings.json'

export const SHIPPED_APPEARANCE: Appearance = {
  accent: SHIPPED_ACCENT,
  density: EBlockDensity.Comfort,
  composer: EComposerEdge.Slab, imageRows: SHIPPED_IMAGE_ROWS,
  fenceWrap: SHIPPED_FENCE_WRAP,
}

export const SECRETS_ORIGIN = '~/.atlas/secrets.json'

export const page = (args: {
  width?: number
  sidebarWidth?: number
  state?: SettingsState
  layers?: readonly SettingsLayerInput[]
  problem?: string
  prompt?: SecretPrompt
  textPrompt?: TextPrompt
  secretOf?: (id: string) => Span | undefined
  definitions?: readonly SettingDefinition[]
  shadowedAgentTypes?: readonly ShadowedAgentTypeSource[]
  writeOriginOf?: (id: string) => string | undefined
}): React.ReactNode => {
  const definitions = args.definitions ?? ATLAS_SETTINGS
  const resolution = resolveSettings({ definitions, layers: args.layers ?? [] })

  return (
    <Settings
      width={args.width ?? WIDE}
      sidebarWidth={args.sidebarWidth ?? SIDEBAR_WIDTH}
      model={settingsModel({
        definitions,
        resolution,
        ...(args.shadowedAgentTypes === undefined ? {} : { shadowedAgentTypes: args.shadowedAgentTypes }),
        ...(args.writeOriginOf === undefined ? {} : { writeOriginOf: args.writeOriginOf }),
      })}
      state={args.state ?? { pageIndex: 0, rowIndex: 0 }}
      cwd="/Users/dennis/Developer/atlas"
      origin={ORIGIN}
      appearance={SHIPPED_APPEARANCE}
      prompt={args.prompt ?? null}
      textPrompt={args.textPrompt ?? null}
      secretOf={args.secretOf ?? (() => undefined)}
      secretOrigin={SECRETS_ORIGIN}
      {...(args.problem === undefined ? {} : { problem: args.problem })}
      cloudEmail={null}
      cloudSignedIn={false}
      cloudSignIn={idleLogin()}
      cloudAction={ECloudAction.SignOut}
      cloudUpload={idleSync()}
      cloudDownload={idleSync()}
      github={{
        connection: null,
        unreachable: false,
        flow: idleLogin(),
        onActivate: () => {},
        onOpenUrl: () => {},
      }}
      onSignOut={() => {}}
      onSignIn={() => {}}
      onOpenSignInUrl={() => {}}
      onUpload={() => {}}
      onDownload={() => {}}
      onSelect={() => {}}
      onDismiss={() => {}}
      qualityHealth={{
        read: { kind: EQualityHealthReadKind.Loading },
        enabled: false,
        recording: false,
        threadId: toThreadId('settings-render-thread'),
      }}
    />
  )
}

export const rowsOf = async (node: React.ReactNode, width: number): Promise<string[]> =>
  (await frameOf(node, width)).split('\n')

export const CUSTOM_DECISIONS: readonly SettingsLayerInput[] = [
  { layer: ESettingsLayer.User, origin: 'user', values: { [ESettingId.DecisionsProvider]: 'custom' } },
]

export const stateOf = (id: ESettingId, layers: readonly SettingsLayerInput[] = []): SettingsState => {
  const resolution = resolveSettings({ definitions: ATLAS_SETTINGS, layers })
  const model = settingsModel({ definitions: ATLAS_SETTINGS, resolution })

  for (const [pageIndex, page] of model.pages.entries()) {
    const rowIndex = page.rows.findIndex((row) => row.definition.id === id)
    if (rowIndex !== -1) return { pageIndex, rowIndex }
  }

  throw new Error(`no row for ${id}`)
}

export const ACCENT_ROW = stateOf(ESettingId.Accent)

export const SIDEBAR_ROW = stateOf(ESettingId.SidebarWidth)

export const DENSITY_ROW = stateOf(ESettingId.BlockPadding)

export const COMPOSER_ROW = stateOf(ESettingId.ComposerEdge)

export const BAND_EDGE = '│'

export const BAND_TOP_LEFT = '┌'

export const BAND_TOP_RIGHT = '┐'

export const BAND_BOTTOM_LEFT = '└'

export const rowWith = (rows: readonly string[], needle: string): string =>
  rows.find((row) => row.includes(needle)) ?? ''
