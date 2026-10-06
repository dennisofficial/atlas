import { randomUUID } from 'node:crypto'

import type { DockerEngine } from '../engine'
import { worktreeLabel } from '../sandbox'

export type TestCleanupEngine = Pick<
  DockerEngine,
  'listContainers' | 'removeContainer' | 'listNetworks' | 'removeNetwork'
>

export const uniqueTestPrefix = (suite: string): string =>
  `atlas-dev-${suite}-${process.pid}-${randomUUID().slice(0, 8)}`

const attempt = async (args: {
  failures: unknown[]
  work: () => Promise<void>
}): Promise<void> => {
  try {
    await args.work()
  } catch (error) {
    args.failures.push(error)
  }
}

export async function removeTestSandboxes(args: {
  engine: TestCleanupEngine
  prefix: string
}): Promise<void> {
  const labels = { [worktreeLabel(args.prefix)]: undefined }
  const failures: unknown[] = []

  await attempt({
    failures,
    work: async () => {
      const containers = await args.engine.listContainers({ labels, all: true })
      for (const container of containers) {
        await attempt({ failures, work: () => args.engine.removeContainer({ id: container.id }) })
      }
    },
  })

  await attempt({
    failures,
    work: async () => {
      const networks = await args.engine.listNetworks({ labels })
      for (const network of networks) {
        await attempt({ failures, work: () => args.engine.removeNetwork({ id: network.id }) })
      }
    },
  })

  if (failures.length > 0) {
    throw new AggregateError(failures, `test sandbox teardown failed for prefix ${args.prefix}`)
  }
}
