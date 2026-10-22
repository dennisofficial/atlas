import { BadRequestException, ConflictException } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { registerSandboxRow, stampRegistrationMetadata } from './sandbox-claim'
import { findOrCreateClaimThread } from './sandbox-thread'
import { hashSessionToken } from './sandbox-tokens'
import { assertClientTokenShape, assertPublicServeUrl } from './serve-url'
import { ESandboxState, type SandboxAttachmentDto } from './sandboxes.types'
import { SANDBOX_REGION } from './vercel-sandbox.client'

export type RegisterSandboxArgs = {
  userId: string
  threadId: string
  clientToken: string
  serveUrl: string | undefined
  serveVersion?: string | undefined
  metadata?: { title?: string; repo?: string; model?: string } | undefined
}

export async function registerSandbox(
  args: RegisterSandboxArgs & { cipher: SecretCipherService },
): Promise<SandboxAttachmentDto> {
  const { cipher } = args
  assertClientTokenShape(args.clientToken)
  if (args.serveUrl === undefined) throw new BadRequestException('serveUrl is required')
  assertPublicServeUrl(args.serveUrl)
  const tokenHash = hashSessionToken(args.clientToken)
  const lease = await db.orm.public.LocalPodLease.where({ tokenHash }).select('id').first()
  if (lease !== null) throw new ConflictException('this token is already in use by another credential')
  const thread = await findOrCreateClaimThread({
    db,
    userId: args.userId,
    threadId: args.threadId,
  })
  const row = await registerSandboxRow({
    thread,
    tokenHash,
    sealedToken: cipher.encrypt(args.clientToken),
    serveUrl: args.serveUrl,
    ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
  })
  await stampRegistrationMetadata({ thread, metadata: args.metadata })
  return {
    threadId: args.threadId,
    name: row.name,
    region: SANDBOX_REGION,
    state: ESandboxState.Running,
    lastActivityAt: new Date().toISOString(),
    contextPending: false,
    token: args.clientToken,
    url: args.serveUrl,
  }
}
