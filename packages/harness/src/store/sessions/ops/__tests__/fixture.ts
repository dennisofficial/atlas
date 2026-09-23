import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EventDraft, ThreadId } from '@dltech/atlas-core'

import {
  CountingIds,
  SteppingClock,
  UnstaffedAgents,
  UnstaffedShells,
  UnstaffedServices,
} from '../../../__tests__/harness'
import { JsonlEventLog } from '../../event-log'
import { SessionRegistry } from '../../registry'

export type OpsFixture = {
  home: string
  registry: SessionRegistry
  log: JsonlEventLog
  clock: SteppingClock
  ids: CountingIds
  agents: UnstaffedAgents
  shells: UnstaffedShells
  services: UnstaffedServices
}

const directories: string[] = []

export async function openOpsFixture(): Promise<OpsFixture> {
  const home = await mkdtemp(join(tmpdir(), 'atlas-ops-'))
  directories.push(home)
  const registry = new SessionRegistry(home)
  const clock = new SteppingClock()
  const ids = new CountingIds('ops')
  const log = new JsonlEventLog(home, registry, clock, ids)
  return {
    home,
    registry,
    log,
    clock,
    ids,
    agents: new UnstaffedAgents(),
    shells: new UnstaffedShells(),
    services: new UnstaffedServices(),
  }
}

export async function closeOpsFixtures(): Promise<void> {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}

export function reopenOpsFixture({ fixture }: { fixture: OpsFixture }): OpsFixture {
  const registry = new SessionRegistry(fixture.home)
  const clock = new SteppingClock()
  const ids = new CountingIds('reopen')
  return {
    home: fixture.home,
    registry,
    log: new JsonlEventLog(fixture.home, registry, clock, ids),
    clock,
    ids,
    agents: new UnstaffedAgents(),
    shells: new UnstaffedShells(),
    services: new UnstaffedServices(),
  }
}

export async function openThread({
  fixture,
  drafts,
}: {
  fixture: OpsFixture
  drafts: readonly EventDraft[]
}): Promise<ThreadId> {
  const threadId = fixture.ids.nextThreadId()
  await fixture.log.append({ threadId, runId: fixture.ids.nextRunId(), drafts })
  return threadId
}
