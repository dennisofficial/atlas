import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { MiddlewareOptions, MiddlewareResponse, TRPCMiddleware } from 'nestjs-trpc'
import type { SessionVerifier } from '../../../_core/ports/session-verifier'
import { SESSION_VERIFIER } from '../../../_core/ports/session-verifier'
import type {
  PodPrincipal,
  SandboxPrincipal,
  VerifiedSession,
} from '../../../_core/types/auth.types'
import { type ApiTrpcCtx, isApiTrpcCtx } from '../../../_module/trpc/api-trpc-context'
import { metaOf } from '../../../_module/trpc/procedure-meta'
import { SandboxesService } from '../sandboxes/sandboxes.service'
import { ETokenPrincipalKind } from '../sandboxes/token-principal'

export type SessionOrSandboxTrpcCtx = ApiTrpcCtx & {
  auth: VerifiedSession
  sandbox?: SandboxPrincipal
  pod?: PodPrincipal
}

const threadIdOf = (rawInput: unknown): string | undefined => {
  if (typeof rawInput !== 'object' || rawInput === null || !('threadId' in rawInput)) {
    return undefined
  }
  const { threadId } = rawInput
  return typeof threadId === 'string' && threadId.length > 0 ? threadId : undefined
}

@Injectable()
export class SessionOrSandboxMiddleware implements TRPCMiddleware {
  constructor(
    @Inject(SESSION_VERIFIER) private readonly verifier: SessionVerifier,
    @Inject(SandboxesService) private readonly sandboxes: SandboxesService,
  ) {}

  async use({ ctx, meta, getRawInput, next }: MiddlewareOptions): MiddlewareResponse {
    const procedureMeta = metaOf(meta)
    if (procedureMeta.public === true) return next()
    if (!isApiTrpcCtx(ctx)) throw new UnauthorizedException('a valid session is required')

    if (ctx.bearerToken !== undefined) {
      const row = await this.sandboxes
        .verifyTokenPrincipal({ token: ctx.bearerToken })
        .catch(() => null)
      if (row?.kind === ETokenPrincipalKind.Pod) {
        if (procedureMeta.podReachable !== true) {
          throw new ForbiddenException('a pod lease token does not reach this route')
        }
        const auth: VerifiedSession = {
          userId: row.userId,
          sessionId: `pod:${row.threadId}`,
          email: '',
        }
        return next({ ctx: { ...ctx, auth, pod: { threadId: row.threadId } } })
      }
      if (row !== null) {
        const threadId = threadIdOf(await getRawInput())
        if (threadId !== undefined) {
          await this.sandboxes.assertThreadInFamily({ sandboxThreadId: row.threadId, threadId })
        } else if (procedureMeta.sandboxReachable !== true) {
          throw new ForbiddenException('a sandbox session token does not reach this route')
        }
        const auth: VerifiedSession = {
          userId: row.userId,
          sessionId: `sandbox:${row.id}`,
          email: '',
        }
        return next({
          ctx: { ...ctx, auth, sandbox: { sandboxId: row.id, threadId: row.threadId } },
        })
      }
    }

    const auth = await this.verifier.verify(ctx.req)
    if (!auth) throw new UnauthorizedException('a valid session is required')
    return next({ ctx: { ...ctx, auth } })
  }
}
