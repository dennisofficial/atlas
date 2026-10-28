import type { ERunner } from '@dltech/atlas-core'
import type { CloudBridge } from '@dltech/atlas-harness'
import type { ThreadId } from '@dltech/atlas-core'

export type BootStepListener = (args: { threadId: ThreadId; label: string }) => void

export type CloudBridgeFactory = (args: {
  runner: ERunner
  onBootStep?: BootStepListener | undefined
}) => CloudBridge

export type BirthPreflight = (args: { runner: ERunner }) => Promise<string | null>
