import type { PodsEnv } from '../../env'
import type { Agent37Status } from './agent37-client'

export type Agent37Env = NonNullable<PodsEnv['agent37']>

export const AGENT37_POD_SESSION_KEY = 'atlasPodSessionId'

export const AGENT37_DISK_NUDGED_KEY = 'atlasDiskNudgedPercent'

export const agent37InstanceNameOf = (podSessionId: string): string => `atlas-${podSessionId}`

export type Agent37InstanceIds = {
  find(args: { podSessionId: string }): Promise<string | null>
  remember(args: { podSessionId: string; instanceId: string }): Promise<void>
  forget(args: { podSessionId: string }): Promise<void>
  seedStatus(args: { podSessionId: string; status: Agent37Status; at: string }): Promise<void>
}
