import { QualityContractError, type QualityPolicy, type QualityPolicyDescriptor } from './policy'

export type QualityRegistry = {
  descriptors(): readonly QualityPolicyDescriptor[]
  policies(): readonly QualityPolicy[]
  get(args: { id: string }): QualityPolicy | undefined
  enabled(args: { settings: Readonly<Record<string, boolean>> }): readonly QualityPolicy[]
  enabledIds(args: { settings: Readonly<Record<string, boolean>> }): readonly string[]
}

const byId = (left: QualityPolicy, right: QualityPolicy): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

const describe = (policy: QualityPolicy): QualityPolicyDescriptor => ({
  id: policy.id,
  version: policy.version,
  title: policy.title,
  description: policy.description,
  settingKey: policy.settingKey,
  defaultEnabled: policy.defaultEnabled,
})

function assertUnique({ policies, field }: { policies: readonly QualityPolicy[]; field: 'id' | 'settingKey' }): void {
  const seen = new Set<string>()
  for (const policy of policies) {
    const value = policy[field]
    if (seen.has(value)) throw new QualityContractError(`duplicate quality policy ${field} "${value}"`)
    seen.add(value)
  }
}

export function createQualityRegistry({ policies }: { policies: readonly QualityPolicy[] }): QualityRegistry {
  assertUnique({ policies, field: 'id' })
  assertUnique({ policies, field: 'settingKey' })

  const ordered = [...policies].sort(byId)
  const descriptors = ordered.map(describe)
  const index = new Map(ordered.map((policy) => [policy.id, policy]))
  const enabled = ({ settings }: { settings: Readonly<Record<string, boolean>> }): readonly QualityPolicy[] =>
    ordered.filter((policy) => settings[policy.settingKey] ?? policy.defaultEnabled)

  return {
    descriptors: () => descriptors,
    policies: () => ordered,
    get: ({ id }) => index.get(id),
    enabled,
    enabledIds: ({ settings }) => enabled({ settings }).map((policy) => policy.id),
  }
}
