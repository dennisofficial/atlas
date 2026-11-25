import { TRPCError } from '@trpc/server'
import {
  terminalCloseInputSchema,
  terminalListInputSchema,
  terminalListOutputSchema,
  terminalMutationOutputSchema,
  terminalOpenInputSchema,
  terminalOpenOutputSchema,
  terminalReadInputSchema,
  terminalReadOutputSchema,
  terminalRenameInputSchema,
  terminalResizeInputSchema,
  terminalWriteInputSchema,
  type TerminalListInput,
  type TerminalListOutput,
  type TerminalMutationOutput,
  type TerminalOpenInput,
  type TerminalOpenOutput,
  type TerminalReadInput,
  type TerminalReadOutput,
  type TerminalRenameInput,
  type TerminalResizeInput,
  type TerminalWriteInput,
} from '@dltech/atlas-protocol'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { TerminalService } from './terminal.service'

@Router({ alias: 'terminal' })
@UseMiddlewares(SessionMiddleware)
export class TerminalRouter {
  constructor(private readonly terminals: TerminalService) {}

  private refuseBatched(ctx: SessionTrpcCtx): void {
    if (ctx.req.query.batch === '1') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'batched calls are not supported' })
    }
  }

  @Query({ input: terminalListInputSchema, output: terminalListOutputSchema })
  list(@Input() input: TerminalListInput, @Ctx() ctx: SessionTrpcCtx): Promise<TerminalListOutput> {
    return this.terminals.list({ userId: ctx.auth.userId, sessionId: input.sessionId })
  }

  @Mutation({ input: terminalOpenInputSchema, output: terminalOpenOutputSchema })
  open(@Input() input: TerminalOpenInput, @Ctx() ctx: SessionTrpcCtx): Promise<TerminalOpenOutput> {
    this.refuseBatched(ctx)
    return this.terminals.open({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: terminalRenameInputSchema, output: terminalMutationOutputSchema })
  rename(
    @Input() input: TerminalRenameInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<TerminalMutationOutput> {
    return this.terminals.rename({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: terminalWriteInputSchema, output: terminalMutationOutputSchema })
  write(
    @Input() input: TerminalWriteInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<TerminalMutationOutput> {
    this.refuseBatched(ctx)
    return this.terminals.write({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: terminalResizeInputSchema, output: terminalMutationOutputSchema })
  resize(
    @Input() input: TerminalResizeInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<TerminalMutationOutput> {
    this.refuseBatched(ctx)
    return this.terminals.resize({ userId: ctx.auth.userId, ...input })
  }

  @Mutation({ input: terminalCloseInputSchema, output: terminalMutationOutputSchema })
  close(
    @Input() input: TerminalListInput & { terminalId: string },
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<TerminalMutationOutput> {
    this.refuseBatched(ctx)
    return this.terminals.close({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: terminalReadInputSchema, output: terminalReadOutputSchema })
  read(@Input() input: TerminalReadInput, @Ctx() ctx: SessionTrpcCtx): Promise<TerminalReadOutput> {
    return this.terminals.read({ userId: ctx.auth.userId, ...input })
  }
}
