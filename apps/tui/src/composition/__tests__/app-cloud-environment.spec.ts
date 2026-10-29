import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ATLAS_TELEMETRY_IDENTITY_ENV,
  EClassifierMode,
  EDecisionsProvider,
  ESettingId,
  EWebSearchBackend,
} from '@dltech/atlas-core'
import { TELEMETRY_FILE_NAME } from '@dltech/atlas-harness'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { telemetryEnvironmentOf } from '../app'
import { livePodBridgeOptionsFor } from '../live-pod'
import { fakeApp, scriptedModelPort } from './fake-app'

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

const persistTelemetryId = (id: string): void => {
  writeFileSync(join(home, TELEMETRY_FILE_NAME), `${JSON.stringify({ distinctId: id })}\n`)
}

describe('telemetryEnvironmentOf', () => {
  it('carries the operator telemetry id when the machine has one', () => {
    const id = '0fe781a8-3c2c-4f97-8d36-7f1b6f2a0a11'
    persistTelemetryId(id)

    expect(telemetryEnvironmentOf()).toEqual({ [ATLAS_TELEMETRY_IDENTITY_ENV]: id })
  })

  it('carries nothing before the machine has captured its first event', () => {
    expect(telemetryEnvironmentOf()).toEqual({})
  })
})

describe('livePodBridgeOptionsFor environment', () => {
  it('carries identity only, never the operator settings the pod reads from cloud config', () => {
    persistTelemetryId('0fe781a8-3c2c-4f97-8d36-7f1b6f2a0a11')
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }),
      settings: {
        values: {
          [ESettingId.DecisionsProvider]: EDecisionsProvider.Custom,
          [ESettingId.DecisionsUrl]: 'https://api.typesafe.ai',
          [ESettingId.DecisionsModel]: 'decider-1',
          [ESettingId.ClassifierMode]: EClassifierMode.Nudge,
          [ESettingId.WebSearchBackend]: EWebSearchBackend.Brave,
        },
      },
    })

    expect(livePodBridgeOptionsFor(app).environment?.()).toEqual(telemetryEnvironmentOf())
  })
})
