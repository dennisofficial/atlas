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
import { CredentialAvailabilityService } from './credential-availability.service'

@Router({ alias: 'credentialAvailability' })
export class CredentialAvailabilityRouter {
  constructor(private readonly availability: CredentialAvailabilityService) {}

  @Query({
    input: inspectAvailabilityInputSchema,
    output: availabilitySnapshotSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  inspect(
    @Input() input: InspectAvailabilityInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AvailabilitySnapshot> {
    return this.availability.inspect({ userId: ctx.auth.userId, input })
  }

  @Mutation({
    input: admitAvailabilityInputSchema,
    output: admissionDecisionSchema,
  })
  @UseMiddlewares(SessionMiddleware)
  admit(
    @Input() input: AdmitAvailabilityInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<AdmissionDecision> {
    return this.availability.admit({ userId: ctx.auth.userId, input })
  }

  @Mutation({
    input: completeAvailabilityInputSchema,
    output: z.void(),
  })
  @UseMiddlewares(SessionMiddleware)
  async complete(
    @Input() input: CompleteAvailabilityInput,
    @Ctx() ctx: SessionTrpcCtx,
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
  })
  @UseMiddlewares(SessionMiddleware)
  async promoteProbe(@Input() input: PromoteProbeInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
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
