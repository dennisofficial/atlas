import type { DaemonSession } from '../client'
import { describeCallsConformance } from './calls'
import { describeFilesConformance } from './files'

export type DaemonSpawnedHandle = {
  pid(): number
  spawnCount(): Promise<number>
  bootId(): Promise<string>
  token: string
  writableCgroups(): Promise<boolean>
  kill(): Promise<void>
}

export type DaemonConformanceTarget = {
  name: string
  setup(): Promise<DaemonSpawnedHandle>
  connect(handle: DaemonSpawnedHandle): Promise<DaemonSession>
  teardown(handle: DaemonSpawnedHandle): Promise<void>
}

export const describeDaemonConformance = (target: DaemonConformanceTarget): void => {
  describeCallsConformance(target)
  describeFilesConformance(target)
}
