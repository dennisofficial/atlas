import {
  sshSigningKeyLeaseSchema,
  sshSigningKeyStatusSchema,
  sshSigningKeyUploadSchema,
  type SshSigningKeyLease,
  type SshSigningKeyStatus,
  type SshSigningKeyUpload,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../../platform/sessions/session-or-sandbox.middleware'
import { markNoStore } from '../no-store'
import { SshSigningKeyService } from './ssh-signing-key.service'

@Router({ alias: 'sshSigningKey' })
export class SshSigningKeyRouter {
  constructor(private readonly keys: SshSigningKeyService) {}

  @Query({
    output: sshSigningKeyLeaseSchema,
    meta: meta({ podReachable: true, sandboxReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  lease(@Ctx() ctx: SessionOrSandboxTrpcCtx): Promise<SshSigningKeyLease> {
    markNoStore(ctx)
    return this.keys.lease({ userId: ctx.auth.userId })
  }

  @Query({ output: sshSigningKeyStatusSchema })
  @UseMiddlewares(SessionMiddleware)
  status(@Ctx() ctx: SessionTrpcCtx): Promise<SshSigningKeyStatus> {
    markNoStore(ctx)
    return this.keys.status({ userId: ctx.auth.userId })
  }

  @Mutation({ input: sshSigningKeyUploadSchema, output: sshSigningKeyStatusSchema })
  @UseMiddlewares(SessionMiddleware)
  register(
    @Input() input: SshSigningKeyUpload,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SshSigningKeyStatus> {
    markNoStore(ctx)
    return this.keys.register({ userId: ctx.auth.userId, privateKey: input.privateKey })
  }

  @Mutation({ input: sshSigningKeyUploadSchema, output: sshSigningKeyStatusSchema })
  @UseMiddlewares(SessionMiddleware)
  rotate(
    @Input() input: SshSigningKeyUpload,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SshSigningKeyStatus> {
    markNoStore(ctx)
    return this.keys.rotate({ userId: ctx.auth.userId, privateKey: input.privateKey })
  }

  @Mutation({ output: z.void() })
  @UseMiddlewares(SessionMiddleware)
  async revoke(@Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.keys.revoke({ userId: ctx.auth.userId })
  }
}
