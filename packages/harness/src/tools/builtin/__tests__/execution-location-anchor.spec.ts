import { afterEach, describe, expect, it } from 'bun:test'

import { EExecutionLocation, type ThreadId } from '@dltech/atlas-core'

import { PlacementController } from '../../../composition/placement-controller'
import type { AnchoringControl } from '../../../composition/sandbox-reanchor'
import type { DockerEngine } from '../../../execution/docker/engine'
import {
  CountingIds,
  openStoreFixture,
  UnstaffedServices,
  UnstaffedShells,
  UnstaffedAgents,
  type StoreFixture,
} from '../../../store/__tests__/harness'
import { ExecutionLocationTool } from '../execution-location'

const fixtures: StoreFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

describe('execution_location re-anchoring', () => {
  it('anchors the sandbox at the directory the tool was called from and records it on the relocation', async () => {
    const fixture = openStoreFixture()
    fixtures.push(fixture)
    const state = new PlacementController(EExecutionLocation.Host)
    state.bind({ threads: fixture.threads, workspace: '/ws', repo: null })
    const prepared: { cwd: string; threadId: ThreadId }[] = []
    const control: AnchoringControl = {
      state,
      pinned: false,
      anchoring: {
        launchDirectory: '/work/boot',
        prepare: async (call) => {
          prepared.push(call)
        },
      },
    }
    const tool = new ExecutionLocationTool({
      control,
      engine: { info: async () => ({ cpus: 8, memoryBytes: 16 * 1024 ** 3 }) } as DockerEngine,
      ids: new CountingIds('anchor-tool'),
      services: new UnstaffedServices(),
      shells: new UnstaffedShells(),
      stores: () => ({ threads: fixture.threads, log: fixture.log, agents: new UnstaffedAgents() }),
    })
    const threadId = (await fixture.threads.create({})).id
    await state.activate({ threadId })

    const outcome = await tool.invoke({
      input: { location: 'docker' },
      signal: new AbortController().signal,
      idempotencyKey: 'key',
      projectDirectory: '/work/boot-2',
      activeWorktree: undefined,
      threadId,
    })

    expect(outcome.ok).toBe(true)
    expect(prepared).toEqual([{ cwd: '/work/boot-2', threadId }])
    const relocation = (await fixture.log.readOwn({ threadId })).find(
      (event) => event.type === 'location-changed',
    )
    expect(relocation).toMatchObject({ to: EExecutionLocation.Docker, cwd: '/work/boot-2' })
  })
})
