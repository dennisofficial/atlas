import { type Db, type Row } from '@dltech/atlas-db'
import { type CloudflareTunnelClient } from './cloudflare-tunnel.client'
import {
  EPreviewClaim,
  claimPreviewTunnel,
  previewClaimWaitAttempts,
  releasePreviewTunnelClaim,
  waitForPreviewClaim,
} from './preview-claim'
import { type PreviewSecretCipher, messageOf, tunnelNameOf } from './preview-rows'
import { EPreviewTunnelState } from './preview-state'

export const EPreviewSeal = {
  Reuse: 'Reuse',
  Verify: 'Verify',
} as const

export type EPreviewSeal = (typeof EPreviewSeal)[keyof typeof EPreviewSeal]

export type PreviewSealDeps = {
  db: Db
  cipher: PreviewSecretCipher
  cloudflare: CloudflareTunnelClient
}

export type PreviewSealOutcome =
  | { kind: 'sealed'; tunnelId: string; sealedTunnelToken: string; tunnelToken: string }
  | { kind: 'claimed-elsewhere' }

function hasSealOf(row: Row<'PreviewTunnel'>): boolean {
  return row.tunnelId !== '' && row.sealedTunnelToken !== ''
}

function sealedOf(row: Row<'PreviewTunnel'>): boolean {
  return row.state === EPreviewTunnelState.Ready && hasSealOf(row)
}

function sealedWhileWeWaited(args: { row: Row<'PreviewTunnel'>; restoreState: string }): boolean {
  return args.restoreState === EPreviewTunnelState.Creating && hasSealOf(args.row)
}

export async function sealPreviewTunnel(args: {
  deps: PreviewSealDeps
  podSessionId: string
  previewTunnelId: string
  seal: EPreviewSeal
}): Promise<PreviewSealOutcome> {
  for (let attempt = 1; attempt <= previewClaimWaitAttempts; attempt += 1) {
    const row = await tunnelRowOf(args)
    if (args.seal === EPreviewSeal.Reuse && sealedOf(row)) {
      return sealedReplyOf({ row, cipher: args.deps.cipher })
    }
    const claim = await claimPreviewTunnel({ db: args.deps.db, podSessionId: args.podSessionId })
    if (claim === EPreviewClaim.Claimed) {
      return await createUnderClaim({ ...args, restoreState: row.state })
    }
    await waitForPreviewClaim()
  }
  return { kind: 'claimed-elsewhere' }
}

async function createUnderClaim(args: {
  deps: PreviewSealDeps
  podSessionId: string
  previewTunnelId: string
  seal: EPreviewSeal
  restoreState: string
}): Promise<PreviewSealOutcome> {
  const row = await tunnelRowOf(args)
  if (
    args.seal === EPreviewSeal.Reuse &&
    sealedWhileWeWaited({ row, restoreState: args.restoreState })
  ) {
    return sealedReplyOf({ row, cipher: args.deps.cipher })
  }
  try {
    const tunnel = await args.deps.cloudflare.ensureTunnel({
      name: tunnelNameOf(args.podSessionId),
    })
    const keepsSeal = row.tunnelId === tunnel.id && row.sealedTunnelToken !== ''
    const sealedTunnelToken = keepsSeal
      ? row.sealedTunnelToken
      : args.deps.cipher.encrypt(tunnel.token)
    await args.deps.db.orm.public.PreviewTunnel.where({ id: row.id }).updateAndCount({
      tunnelId: tunnel.id,
      sealedTunnelToken,
      state: EPreviewTunnelState.Ready,
      lastError: null,
    })
    return {
      kind: 'sealed',
      tunnelId: tunnel.id,
      sealedTunnelToken,
      tunnelToken: keepsSeal ? args.deps.cipher.decrypt(sealedTunnelToken) : tunnel.token,
    }
  } catch (failure) {
    await releasePreviewTunnelClaim({
      db: args.deps.db,
      previewTunnelId: row.id,
      restoreState: args.restoreState,
      lastError: messageOf(failure),
    })
    throw failure
  }
}

async function tunnelRowOf(args: {
  deps: PreviewSealDeps
  previewTunnelId: string
}): Promise<Row<'PreviewTunnel'>> {
  const row = await args.deps.db.orm.public.PreviewTunnel.where({
    id: args.previewTunnelId,
  }).first()
  if (row === null) throw new Error(`preview tunnel ${args.previewTunnelId} disappeared`)
  return row
}

function sealedReplyOf(args: {
  row: Row<'PreviewTunnel'>
  cipher: PreviewSecretCipher
}): PreviewSealOutcome {
  return {
    kind: 'sealed',
    tunnelId: args.row.tunnelId,
    sealedTunnelToken: args.row.sealedTunnelToken,
    tunnelToken: args.cipher.decrypt(args.row.sealedTunnelToken),
  }
}
