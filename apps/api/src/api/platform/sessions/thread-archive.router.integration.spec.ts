import { db, type Row } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { seedSandboxRow, sessionOfThreadRow } from '../../../../test/session-seed'
import { EThreadArchiveCleanupOutcome } from './thread-archive-cleanup.contract'
import {
  createArchiveRouterFixture,
  seedArchiveFamily,
  seedArchivePreview,
} from './thread-archive.router.fixture'
import { mutate, session, USER_ID } from './threads-routers.fixture'

async function expectRunning(row: Row<'CloudSandbox'>) {
  expect(await db.orm.public.CloudSandbox.where({ id: row.id }).first()).toMatchObject({
    id: row.id,
    sessionId: row.sessionId,
    name: row.name,
    state: 'running',
  })
}

async function expectOnlyArchived(args: { threadId: string; family: Row<'Thread'>[] }) {
  for (const thread of args.family) {
    const owned = await sessionOfThreadRow(thread.id)
    expect(owned).not.toBeNull()
    if (thread.id === args.threadId) expect(owned?.archivedAt).toBeInstanceOf(Date)
    else expect(owned?.archivedAt).toBeNull()
  }
}

describe('threads.archive sandbox ownership through HTTP and dispatched cleanup', () => {
  useTestDatabase()
  let fixture: Awaited<ReturnType<typeof createArchiveRouterFixture>>
  let family: Awaited<ReturnType<typeof seedArchiveFamily>>

  beforeEach(async () => {
    fixture = await createArchiveRouterFixture()
    family = await seedArchiveFamily()
  })

  afterEach(async () => {
    await fixture.close()
  })

  async function archive(threadId: string) {
    const response = await mutate({
      app: fixture.app,
      procedure: 'threads.archive',
      headers: session,
      body: { threadId, archived: true },
    })
    expect(response.status).toBe(200)
    const archivedAt = (await sessionOfThreadRow(threadId))?.archivedAt?.toISOString()
    if (archivedAt === undefined) throw new Error('Archived session has no archive timestamp')
    expect(fixture.dispatcher.calls).toEqual([
      {
        payload: { threadId, archivedAt },
        idempotencyKey: `thread-archive-cleanup:${threadId}:${archivedAt}`,
      },
    ])
    return fixture.dispatcher.runNext()
  }

  it('archives a shared teammate without stopping or deleting its manager or sibling', async () => {
    const result = await archive(family.child.id)

    await expectRunning(family.managerSandbox)
    await expectRunning(family.siblingSandbox)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(fixture.notifyParked).not.toHaveBeenCalled()
    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.NoSandbox)
    await expectOnlyArchived({
      threadId: family.child.id,
      family: [family.manager, family.child, family.sibling, family.nested],
    })
    expect(
      await db.orm.public.PreviewTunnel.where({ id: family.managerPreview.id }).first(),
    ).not.toBeNull()
    expect(fixture.deleteTunnel).not.toHaveBeenCalled()
    expect(fixture.deleteDnsRecord).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'archives a nested shared teammate without touching ancestors with an intermediate pod: %s',
    async (ownIntermediatePod) => {
      const intermediate = ownIntermediatePod
        ? await seedSandboxRow({ threadId: family.child.id, userId: USER_ID })
        : null

      const result = await archive(family.nested.id)

      await expectRunning(family.managerSandbox)
      await expectRunning(family.siblingSandbox)
      if (intermediate !== null) await expectRunning(intermediate)
      expect(fixture.stop).not.toHaveBeenCalled()
      expect(fixture.notifyParked).not.toHaveBeenCalled()
      expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.NoSandbox)
      await expectOnlyArchived({
        threadId: family.nested.id,
        family: [family.manager, family.child, family.sibling, family.nested],
      })
      expect(
        await db.orm.public.PreviewTunnel.where({ id: family.managerPreview.id }).first(),
      ).not.toBeNull()
      expect(fixture.deleteTunnel).not.toHaveBeenCalled()
      expect(fixture.deleteDnsRecord).not.toHaveBeenCalled()
    },
  )

  it('archives a parent and parks only its own pod and removes only its own preview', async () => {
    const childSandbox = await seedSandboxRow({ threadId: family.child.id, userId: USER_ID })
    const childPreview = await seedArchivePreview({ threadId: family.child.id })

    const result = await archive(family.manager.id)

    expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Parked)
    expect(
      await db.orm.public.CloudSandbox.where({ id: family.managerSandbox.id }).first(),
    ).toMatchObject({ id: family.managerSandbox.id, state: 'parked' })
    await expectRunning(childSandbox)
    await expectRunning(family.siblingSandbox)
    expect(fixture.stop.mock.calls).toEqual([
      [{ threadId: family.manager.id, name: family.managerSandbox.name }],
    ])
    await expectOnlyArchived({
      threadId: family.manager.id,
      family: [family.manager, family.child, family.sibling, family.nested],
    })
    expect(
      await db.orm.public.PreviewTunnel.where({ id: family.managerPreview.id }).first(),
    ).toBeNull()
    expect(await db.orm.public.PreviewTunnel.where({ id: childPreview.id }).first()).not.toBeNull()
    expect(fixture.deleteTunnel.mock.calls).toEqual([[{ tunnelId: 'tunnel-manager' }]])
    expect(fixture.deleteDnsRecord.mock.calls).toEqual([[{ recordId: 'dns-manager' }]])
  })

  it.each(['child', 'nested'] as const)(
    'archives a managed %s with its own pod without skipping it or touching another pod',
    async (target) => {
      const childSandbox = await seedSandboxRow({ threadId: family.child.id, userId: USER_ID })
      const nestedSandbox = await seedSandboxRow({ threadId: family.nested.id, userId: USER_ID })
      const own = target === 'child' ? childSandbox : nestedSandbox
      const other = target === 'child' ? nestedSandbox : childSandbox
      const ownPreview = await seedArchivePreview({ threadId: family[target].id })

      const result = await archive(family[target].id)

      expect(result.outcome).toBe(EThreadArchiveCleanupOutcome.Parked)
      expect(await db.orm.public.CloudSandbox.where({ id: own.id }).first()).toMatchObject({
        id: own.id,
        state: 'parked',
      })
      await expectRunning(family.managerSandbox)
      await expectRunning(family.siblingSandbox)
      await expectRunning(other)
      expect(fixture.stop.mock.calls).toEqual([[{ threadId: family[target].id, name: own.name }]])
      await expectOnlyArchived({
        threadId: family[target].id,
        family: [family.manager, family.child, family.sibling, family.nested],
      })
      expect(await db.orm.public.PreviewTunnel.where({ id: ownPreview.id }).first()).toBeNull()
      expect(
        await db.orm.public.PreviewTunnel.where({ id: family.managerPreview.id }).first(),
      ).not.toBeNull()
      expect(fixture.deleteTunnel.mock.calls).toEqual([[{ tunnelId: `tunnel-${target}` }]])
      expect(fixture.deleteDnsRecord.mock.calls).toEqual([[{ recordId: `dns-${target}` }]])
    },
  )
})
