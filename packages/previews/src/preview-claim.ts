import { type Db } from '@dltech/atlas-db'
import { EPreviewTunnelState } from './preview-state'

const CLAIM_TTL_SECONDS = 120
const CLAIM_WAIT_STEP_MS = 250
const CLAIM_WAIT_ATTEMPTS = 10

export const EPreviewClaim = {
  Claimed: 'Claimed',
  Held: 'Held',
} as const

export type EPreviewClaim = (typeof EPreviewClaim)[keyof typeof EPreviewClaim]

export async function claimPreviewTunnel(args: {
  db: Db
  podSessionId: string
}): Promise<EPreviewClaim> {
  const claimed = await args.db.query(
    args.db.raw.sql`UPDATE "public"."PreviewTunnel"
      SET "state" = ${EPreviewTunnelState.Creating}, "updatedAt" = now()
      WHERE "podSessionId" = ${args.podSessionId}
        AND (
          "state" <> ${EPreviewTunnelState.Creating}
          OR "updatedAt" < now() - ${`${CLAIM_TTL_SECONDS} seconds`}::interval
        )
      RETURNING "id"`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
  return claimed.length > 0 ? EPreviewClaim.Claimed : EPreviewClaim.Held
}

export async function releasePreviewTunnelClaim(args: {
  db: Db
  previewTunnelId: string
  restoreState: string
  lastError: string
}): Promise<void> {
  await args.db.query(
    args.db.raw.sql`UPDATE "public"."PreviewTunnel"
      SET "state" = ${args.restoreState}, "lastError" = ${args.lastError}, "updatedAt" = now()
      WHERE "id" = ${args.previewTunnelId} AND "state" = ${EPreviewTunnelState.Creating}
      RETURNING "id"`
      .returnsRow({ id: 'pg/text@1' })
      .build(),
  )
}

export const previewClaimWaitAttempts = CLAIM_WAIT_ATTEMPTS

export function waitForPreviewClaim(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, CLAIM_WAIT_STEP_MS)
  })
}
