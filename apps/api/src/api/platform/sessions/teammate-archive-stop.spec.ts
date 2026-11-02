import { ServiceUnavailableException } from '@nestjs/common'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { db } from '@dltech/atlas-db'
import { EAgentStatus, EKilledBy } from '@dltech/atlas-core'
import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { seedSandboxRow, seedThreadRow, seedUsers, USER_A } from '../../../../test/session-seed'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'
import { inertSignals } from './thread-signals.fixture'
import { TeammateArchiveStopService } from './teammate-archive-stop'

const neverLookedUp: SandboxCredentials = {
  forThread: () => Promise.reject(new Error('the pod is never reached in these specs')),
}

const serviceWith = (
  stopTeammate: (args: { threadId: string; name: string; agentId: string }) => Promise<void>,
): TeammateArchiveStopService => {
  const vercel = new VercelSandboxClient(neverLookedUp)
  vercel.stopTeammate = stopTeammate
  return new TeammateArchiveStopService(vercel, inertSignals())
}

const seedManagedTeammate = async (args: {
  bootSteps?: boolean
  podState?: 'running' | 'parked'
}) => {
  await seedThreadRow({ id: 'brn_lead', userId: USER_A })
  await seedSandboxRow({
    threadId: 'brn_lead',
    sessionId: 'ses_brn_lead',
    state: args.podState ?? 'running',
  })
  if (args.bootSteps !== false) {
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_brn_lead',
      step: 'provision',
      state: 'done',
    })
  }
  await db.orm.public.Session.create({
    id: 'ses_brn_mate',
    userId: USER_A,
    managedBySessionId: 'ses_brn_lead',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await seedThreadRow({
    id: 'brn_mate',
    userId: USER_A,
    sessionId: 'ses_brn_mate',
    spawnerThreadId: 'brn_lead',
  })
}

const leadEndings = () =>
  db.orm.public.Event.where({ threadId: 'brn_lead', type: 'agent-ended' }).all()

describe('TeammateArchiveStopService', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers(USER_A)
  })

  it('does nothing for a top-level session', async () => {
    await seedThreadRow({ id: 'brn_main', userId: USER_A })
    await seedSandboxRow({ threadId: 'brn_main' })
    let stopped = 0
    const service = serviceWith(async () => {
      stopped += 1
    })

    await service.stopIfManaged({ userId: USER_A, sessionId: 'ses_brn_main', threadId: 'brn_main' })

    expect(stopped).toBe(0)
    expect(await leadEndings()).toHaveLength(0)
  })

  it('stops a managed teammate in a running pod without appending to the pod-owned log', async () => {
    await seedManagedTeammate({})
    const stops: string[] = []
    const service = serviceWith(async ({ agentId }) => {
      stops.push(agentId)
    })

    await service.stopIfManaged({ userId: USER_A, sessionId: 'ses_brn_mate', threadId: 'brn_mate' })

    expect(stops).toEqual(['brn_mate'])
    expect(await leadEndings()).toHaveLength(0)
  })

  it('records the ending itself only when the pod is parked', async () => {
    await seedManagedTeammate({ podState: 'parked' })
    let stopped = 0
    const service = serviceWith(async () => {
      stopped += 1
    })

    await service.stopIfManaged({ userId: USER_A, sessionId: 'ses_brn_mate', threadId: 'brn_mate' })

    expect(stopped).toBe(0)
    const [ending] = await leadEndings()
    expect(ending).not.toBeUndefined()
    const body = JSON.parse(ending!.body) as {
      agentId: string
      status: string
      killedBy: string
      relayed?: boolean
    }
    expect(body).toMatchObject({
      agentId: 'brn_mate',
      status: EAgentStatus.Stopped,
      killedBy: EKilledBy.User,
      relayed: false,
    })
  })

  it('does nothing when the pod was never provisioned', async () => {
    await seedManagedTeammate({ bootSteps: false })
    let stopped = 0
    const service = serviceWith(async () => {
      stopped += 1
    })

    await service.stopIfManaged({ userId: USER_A, sessionId: 'ses_brn_mate', threadId: 'brn_mate' })

    expect(stopped).toBe(0)
    expect(await leadEndings()).toHaveLength(0)
  })

  it('a failed stop in a running pod refuses the archive and leaves the log untouched', async () => {
    await seedManagedTeammate({})
    const service = serviceWith(() => Promise.reject(new Error('pod gone')))

    const failure = await service
      .stopIfManaged({ userId: USER_A, sessionId: 'ses_brn_mate', threadId: 'brn_mate' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ServiceUnavailableException)
    expect((failure as ServiceUnavailableException).message).toBe(
      "Couldn't stop the teammate, so it wasn't marked done. Try again.",
    )
    expect(await leadEndings()).toHaveLength(0)
  })
})
