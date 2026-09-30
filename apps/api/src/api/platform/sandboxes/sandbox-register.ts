import { BadRequestException } from '@nestjs/common'
import { db } from '../../../db'
import type { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { registerSandboxRow, stampRegistrationMetadata } from './sandbox-claim'
import { findOrCreateClaimThread } from './sandbox-thread'
import { hashSessionToken } from './sandbox-tokens'
import { assertClientTokenShape, assertPublicServeUrl } from './serve-url'
import { ESandboxState, type SandboxAttachmentDto } from './sandboxes.types'
import { SANDBOX_REGION } from './vercel-sandbox.client'

const nowIso = (): string => new Date().toISOString()

export type RegisterSandboxArgs = {
  userId: string
  threadId: string
  clientToken: string
  serveUrl: string | undefined
  driveName?: string | null | undefined
  metadata?: { title?: string; repo?: string; model?: string } | undefined
}

export async function registerSandbox(
  cipher: SecretCipherService,
  args: RegisterSandboxArgs,
): Promise<SandboxAttachmentDto> {
  assertClientTokenShape(args.clientToken)
  if (args.serveUrl === undefined) throw new BadRequestException('serveUrl is required')
  assertPublicServeUrl(args.serveUrl)
  const thread = await findOrCreateClaimThread({
    db,
    userId: args.userId,
    threadId: args.threadId,
  })
  const row = await registerSandboxRow({
    thread,
    tokenHash: hashSessionToken(args.clientToken),
    sealedToken: cipher.encrypt(args.clientToken),
    serveUrl: args.serveUrl,
    ...(args.driveName === undefined ? {} : { driveName: args.driveName }),
  })
  await stampRegistrationMetadata({ thread, metadata: args.metadata })
  return {
    threadId: args.threadId,
    name: row.name,
    region: SANDBOX_REGION,
    state: ESandboxState.Running,
    lastActivityAt: nowIso(),
    contextPending: false,
    token: args.clientToken,
    url: args.serveUrl,
  }
}
