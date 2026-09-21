import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  EClassifierMode,
  ESettingId,
  type ClassifierPolicy,
} from '@dltech/atlas-core'

import { createIsolatedContainer } from '../../container/injection'
import { ClassifierPolicyToken } from '../../container/tokens'
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
