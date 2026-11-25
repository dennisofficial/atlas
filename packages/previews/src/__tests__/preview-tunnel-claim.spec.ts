import { seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { EPreviewClaim, claimPreviewTunnel, releasePreviewTunnelClaim } from '../preview-claim'
import { EPreviewTunnelState } from '../preview-state'

describe('the preview tunnel claim', () => {
  const currentDb = useTestDatabase()

  const seed = async (state: string) =>
    await currentDb().db.orm.public.PreviewTunnel.create({
      userId: 'usr-1',
      podSessionId: 'pod-1',
      createdByThreadId: 'thr-1',
      label: 'label00001',
      state,
    })

  const rowOf = async () =>
    await currentDb().db.orm.public.PreviewTunnel.where({ podSessionId: 'pod-1' }).first()

  const claim = async () => await claimPreviewTunnel({ db: currentDb().db, podSessionId: 'pod-1' })

  const ageClaimBy = async (args: { previewTunnelId: string; minutes: number }) => {
    await currentDb().db.query(
      currentDb().db.raw.sql`UPDATE "public"."PreviewTunnel"
        SET "state" = ${EPreviewTunnelState.Creating},
          "updatedAt" = now() - ${`${args.minutes} minutes`}::interval
        WHERE "id" = ${args.previewTunnelId}
        RETURNING "id"`
        .returnsRow({ id: 'pg/text@1' })
        .build(),
    )
  }

  beforeEach(async () => {
    await seedUser({ db: currentDb().db, id: 'usr-1' })
  })

  it('claims a pending row and reports the claim as held by the next caller', async () => {
    await seed(EPreviewTunnelState.Pending)

    expect(await claim()).toBe(EPreviewClaim.Claimed)
    expect((await rowOf())?.state).toBe(EPreviewTunnelState.Creating)
    expect(await claim()).toBe(EPreviewClaim.Held)
  })

  it('takes over the claim a dead process left behind', async () => {
    const row = await seed(EPreviewTunnelState.Pending)
    await ageClaimBy({ previewTunnelId: row.id, minutes: 10 })

    expect(await claim()).toBe(EPreviewClaim.Claimed)
  })

  it('restores the state it claimed and records the failure', async () => {
    const row = await seed(EPreviewTunnelState.Ready)
    await claim()

    await releasePreviewTunnelClaim({
      db: currentDb().db,
      previewTunnelId: row.id,
      restoreState: EPreviewTunnelState.Ready,
      lastError: 'cf down',
    })

    const released = await rowOf()
    expect(released?.state).toBe(EPreviewTunnelState.Ready)
    expect(released?.lastError).toBe('cf down')
  })

  it('leaves a row it does not hold untouched', async () => {
    const row = await seed(EPreviewTunnelState.Pending)

    await releasePreviewTunnelClaim({
      db: currentDb().db,
      previewTunnelId: row.id,
      restoreState: EPreviewTunnelState.Ready,
      lastError: 'cf down',
    })

    const untouched = await rowOf()
    expect(untouched?.state).toBe(EPreviewTunnelState.Pending)
    expect(untouched?.lastError).toBeNull()
  })
})
