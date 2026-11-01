import {
  admissionDecisionSchema,
  admitAvailabilityInputSchema,
  availabilitySnapshotSchema,
  completeAvailabilityInputSchema,
  controlAvailabilityInputSchema,
  inspectAvailabilityInputSchema,
  promoteProbeInputSchema,
  type AdmissionDecision,
  type AdmitAvailabilityInput,
  type AvailabilitySnapshot,
  type CompleteAvailabilityInput,
  type ControlAvailabilityInput,
  type InspectAvailabilityInput,
  type PromoteProbeInput,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { meta } from '../../../_module/trpc/procedure-meta'
import {
  SessionOrSandboxMiddleware,
  type SessionOrSandboxTrpcCtx,
} from '../sessions/session-or-sandbox.middleware'
import { CredentialAvailabilityService } from './credential-availability.service'

@Router({ alias: 'credentialAvailability' })
export class CredentialAvailabilityRouter {
  constructor(private readonly availability: CredentialAvailabilityService) {}

  @Query({
    input: inspectAvailabilityInputSchema,
    output: availabilitySnapshotSchema,
    meta: meta({ sandboxReachable: true, podReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  inspect(
    @Input() input: InspectAvailabilityInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<AvailabilitySnapshot> {
    return this.availability.inspect({ userId: ctx.auth.userId, input })
  }

  @Mutation({
    input: admitAvailabilityInputSchema,
    output: admissionDecisionSchema,
    meta: meta({ sandboxReachable: true, podReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  admit(
    @Input() input: AdmitAvailabilityInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<AdmissionDecision> {
    return this.availability.admit({ userId: ctx.auth.userId, input })
  }

  @Mutation({
    input: completeAvailabilityInputSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true, podReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async complete(
    @Input() input: CompleteAvailabilityInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.availability.complete({
      userId: ctx.auth.userId,
      permit: input.permit,
      completion: input.completion,
    })
  }

  @Mutation({
    input: promoteProbeInputSchema,
    output: z.void(),
    meta: meta({ sandboxReachable: true, podReachable: true }),
  })
  @UseMiddlewares(SessionOrSandboxMiddleware)
  async promoteProbe(
    @Input() input: PromoteProbeInput,
    @Ctx() ctx: SessionOrSandboxTrpcCtx,
  ): Promise<void> {
    await this.availability.promoteProbe({
      userId: ctx.auth.userId,
      permit: input.permit,
      failure: input.failure,
    })
  }

  @Mutation({
    input: controlAvailabilityInputSchema,
    output: availabilitySnapshotSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  control(
    @Input() input: ControlAvailabilityInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AvailabilitySnapshot> {
    return this.availability.control({ userId: ctx.auth.userId, input })
  }
}
