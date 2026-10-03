import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EClassifierMode,
  ESettingId,
  type ClassifierPolicy,
} from '@dltech/atlas-core'

import { createIsolatedContainer } from '../../container/injection'
import { ClassifierPolicyToken, MultimodalCapWorkaroundToken } from '../../container/tokens'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { bindSettingsPolicy } from '../policy-bindings'
import { alwaysAuthorised } from './fakes'

const policyOver = async (values: Record<string, string>): Promise<ClassifierPolicy> => {
  const container = createIsolatedContainer()
  await bindSettingsPolicy({
    container,
    settings: createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ document: { values } }),
    }),
    workspace: { workspace: process.cwd(), repo: null },
    credentials: alwaysAuthorised(),
    cwd: process.cwd(),
  })
  return container.resolve(ClassifierPolicyToken)()
}

describe('classifier mode binding', () => {
  it('defaults to shadow when no decision endpoint is configured', async () => {
    expect((await policyOver({})).mode).toBe(EClassifierMode.Shadow)
  })

  it('defaults to nudge once a decision endpoint is configured', async () => {
    const policy = await policyOver({ [ESettingId.DecisionsUrl]: 'https://tokenra.io/v1/decisions' })
    expect(policy.mode).toBe(EClassifierMode.Nudge)
  })

  it('honours an explicit shadow over the decisions default', async () => {
    const policy = await policyOver({
      [ESettingId.DecisionsUrl]: 'https://tokenra.io/v1/decisions',
      [ESettingId.ClassifierMode]: EClassifierMode.Shadow,
    })
    expect(policy.mode).toBe(EClassifierMode.Shadow)
  })

  it('honours an explicit mode either way', async () => {
    const policy = await policyOver({ [ESettingId.ClassifierMode]: EClassifierMode.Nudge })
    expect(policy.mode).toBe(EClassifierMode.Nudge)
  })
})

describe('the multimodal input-cap workaround binding', () => {
  const workaroundOver = async (values: Record<string, string>): Promise<boolean> => {
    const container = createIsolatedContainer()
    await bindSettingsPolicy({
      container,
      settings: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ document: { values } }),
      }),
      workspace: { workspace: process.cwd(), repo: null },
      credentials: alwaysAuthorised(),
      cwd: process.cwd(),
    })
    return container.resolve(MultimodalCapWorkaroundToken)()
  }

  it('is off by default', async () => {
    expect(await workaroundOver({})).toBe(false)
  })

  it('reads live once the toggle is turned on', async () => {
    const settings = createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ document: { values: {} } }),
    })
    const container = createIsolatedContainer()
    await bindSettingsPolicy({
      container,
      settings,
      workspace: { workspace: process.cwd(), repo: null },
      credentials: alwaysAuthorised(),
      cwd: process.cwd(),
    })
    const enabled = container.resolve(MultimodalCapWorkaroundToken)

    expect(enabled()).toBe(false)
    const written = settings.set({ id: ESettingId.MultimodalCapWorkaround, value: true })
    if (!written.ok) throw new Error('the workaround toggle did not land')
    expect(enabled()).toBe(true)
  })
})
