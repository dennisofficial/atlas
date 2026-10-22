import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATLAS_SETTINGS,
  ATLAS_TELEMETRY_IDENTITY_ENV,
  EClassifierMode,
  ESettingsLayer,
  ESettingId,
  EWebSearchBackend,
  resolveSettings,
  type SettingsLayerInput,
} from '@dltech/atlas-core'
import { TELEMETRY_FILE_NAME } from '@dltech/atlas-harness'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { cloudEnvironmentOf, telemetryEnvironmentOf } from '../app'

const resolutionWith = (values: Record<string, unknown>) => {
  const layers: SettingsLayerInput[] = [
    { layer: ESettingsLayer.User, origin: 'user', values },
  ]
  return resolveSettings({ definitions: ATLAS_SETTINGS, layers })
}

describe('cloudEnvironmentOf', () => {
  it('carries the decision URL, classifier mode, and search backend into sandbox env names', () => {
    const env = cloudEnvironmentOf(
      resolutionWith({
        [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai',
        [ESettingId.ClassifierMode]: EClassifierMode.Nudge,
        [ESettingId.WebSearchBackend]: EWebSearchBackend.Brave,
      }),
    )

    expect(env).toEqual({
      ATLAS_DECISIONS_URL: 'https://api.typesafe.ai',
      ATLAS_CLASSIFIER_MODE: 'nudge',
      ATLAS_SEARCH_BACKEND: 'brave',
    })
  })

  it('omits a setting the operator never set so the sandbox reads its own fallback', () => {
    const env = cloudEnvironmentOf(resolutionWith({}))

    expect(env).toEqual({})
  })

  it('omits a setting still at its built-in default even when the default is non-empty', () => {
    const env = cloudEnvironmentOf(resolutionWith({}))

    expect(env).not.toHaveProperty('ATLAS_CLASSIFIER_MODE')
    expect(env).not.toHaveProperty('ATLAS_SEARCH_BACKEND')
  })

  it('omits an empty decision URL rather than handing the sandbox an empty string', () => {
    const env = cloudEnvironmentOf(
      resolutionWith({ [ESettingId.DecisionsUrl]: '' }),
    )

    expect(env).not.toHaveProperty('ATLAS_DECISIONS_URL')
  })
})

describe('telemetryEnvironmentOf', () => {
  let home: string
  let previousHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'atlas-cloud-env-'))
    previousHome = process.env.ATLAS_HOME
    process.env.ATLAS_HOME = home
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  it('carries the operator telemetry id when the machine has one', () => {
    const id = '0fe781a8-3c2c-4f97-8d36-7f1b6f2a0a11'
    writeFileSync(join(home, TELEMETRY_FILE_NAME), `${JSON.stringify({ distinctId: id })}\n`)

    expect(telemetryEnvironmentOf()).toEqual({ [ATLAS_TELEMETRY_IDENTITY_ENV]: id })
  })

  it('carries nothing before the machine has captured its first event', () => {
    expect(telemetryEnvironmentOf()).toEqual({})
  })
})
