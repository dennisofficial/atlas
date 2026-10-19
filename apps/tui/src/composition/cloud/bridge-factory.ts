import type { ERunner } from '@dltech/atlas-core'
import type { CloudBridge } from '@dltech/atlas-harness'

export type CloudBridgeFactory = (args: { runner: ERunner }) => CloudBridge

export type BirthPreflight = (args: { runner: ERunner }) => Promise<string | null>
