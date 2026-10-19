import { toThreadId, type ThreadId } from '@dltech/atlas-core'

import type { ContainerSummary, DockerEngine } from '../../execution/docker/engine'
import { POD_ROLE, podNameFor, podRoleLabel, podThreadLabel } from './pod-create'

export type OrphanPodReaper = {
  engine: Pick<DockerEngine, 'listContainers'>
  destroyPod: (args: { name: string }) => Promise<void>
  threadExists: (args: { threadId: ThreadId }) => Promise<boolean>
  log?: ((line: string) => void) | undefined
}

export type OrphanPodSweep = {
  reaped: string[]
  kept: string[]
  failures: { name: string; error: unknown }[]
}

const containerNameOf = (container: ContainerSummary): string => container.name.replace(/^\//, '')

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const derivedThreadOf = (container: ContainerSummary): ThreadId | undefined => {
  const raw = container.labels[podThreadLabel]
  if (raw === undefined || raw === '') return undefined
  return containerNameOf(container) === podNameFor({ threadId: raw }) ? toThreadId(raw) : undefined
}

export async function reapOrphanPods(args: OrphanPodReaper): Promise<OrphanPodSweep> {
  const log = args.log ?? (() => undefined)
  const sweep: OrphanPodSweep = { reaped: [], kept: [], failures: [] }
  const containers = await args.engine.listContainers({
    labels: { [podThreadLabel]: undefined, [podRoleLabel]: POD_ROLE },
    all: true,
  })

  for (const container of containers) {
    const name = containerNameOf(container)
    const threadId = derivedThreadOf(container)
    if (threadId === undefined) {
      log(`keeping ${name}: its name does not derive from its thread label`)
      sweep.kept.push(name)
      continue
    }

    let exists: boolean
    try {
      exists = await args.threadExists({ threadId })
    } catch (error) {
      log(`keeping ${name}: could not check thread ${threadId}: ${describeError(error)}`)
      sweep.kept.push(name)
      continue
    }
    if (exists) {
      sweep.kept.push(name)
      continue
    }

    try {
      await args.destroyPod({ name })
      log(`reaped orphan pod ${name} (thread ${threadId})`)
      sweep.reaped.push(name)
    } catch (error) {
      log(`failed to reap ${name}: ${describeError(error)}`)
      sweep.failures.push({ name, error })
    }
  }
  return sweep
}
