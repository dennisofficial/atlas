import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EClassifierMode,
  ESettingId,
  type ClassifierPolicy,
} from '@dltech/atlas-core'

import { createIsolatedContainer } from '../../container/injection'
import { ClassifierPolicyToken, GrillingCeremonyEnabledToken } from '../../container/tokens'
import { MemorySecretsStore } from '../../secrets/memory-store'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { bindSettingsPolicy } from '../policy-bindings'
import { alwaysAuthorised } from './fakes'

const policyOver = async (
  values: Record<string, string>,
  secrets: Record<string, string> = {},
): Promise<ClassifierPolicy> => {
  const container = createIsolatedContainer()
  await bindSettingsPolicy({
    container,
    settings: createSettingsService({
      definitions: ATLAS_SETTINGS,
      user: new MemorySettingsStore({ document: { values } }),
    }),
    secrets: new MemorySecretsStore({ secrets }),
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

  it('defaults to shadow on a preset provider that has no key yet', async () => {
    const policy = await policyOver({ [ESettingId.DecisionsProvider]: 'openai' })
    expect(policy.mode).toBe(EClassifierMode.Shadow)
  })

  it('defaults to nudge once the chosen preset has a key, with no url set', async () => {
    const policy = await policyOver(
      { [ESettingId.DecisionsProvider]: 'openai' },
      { 'decisions.token.openai': 'sk-openai' },
    )
    expect(policy.mode).toBe(EClassifierMode.Nudge)
  })

  it('reads the key of the selected provider only', async () => {
    const policy = await policyOver({}, { 'decisions.token.openai': 'sk-openai' })
    expect(policy.mode).toBe(EClassifierMode.Shadow)
  })

  it('defaults to nudge once a custom decision endpoint is configured', async () => {
    const policy = await policyOver({
      [ESettingId.DecisionsProvider]: 'custom',
      [ESettingId.DecisionsUrl]: 'https://tokenra.io/v1/decisions',
    })
    expect(policy.mode).toBe(EClassifierMode.Nudge)
  })

  it('honours an explicit shadow over the decisions default', async () => {
    const policy = await policyOver({
      [ESettingId.DecisionsProvider]: 'custom',
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

describe('grilling ceremony binding', () => {
  const grillingOver = async (values: Record<string, string>): Promise<boolean> => {
    const container = createIsolatedContainer()
    await bindSettingsPolicy({
      container,
      settings: createSettingsService({
        definitions: ATLAS_SETTINGS,
        user: new MemorySettingsStore({ document: { values } }),
      }),
      secrets: new MemorySecretsStore(),
    workspace: { workspace: process.cwd(), repo: null },
      credentials: alwaysAuthorised(),
      cwd: process.cwd(),
    })
    return container.resolve(GrillingCeremonyEnabledToken)()
  }

  it('defaults off', async () => {
    expect(await grillingOver({})).toBe(false)
  })

  it('follows the toggle', async () => {
    expect(await grillingOver({ [ESettingId.GrillingCeremony]: 'true' })).toBe(true)
  })
})
