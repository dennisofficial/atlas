import {
  accountDtoSchema,
  accountIdInputSchema,
  activeAccountDtoSchema,
  activeAccountInputSchema,
  createAccountInputSchema,
  replaceSecretInputSchema,
  setActiveInputSchema,
  setStatusInputSchema,
  storedAccountDtoSchema,
  type AccountDto,
  type AccountIdInput,
  type ActiveAccountDto,
  type ActiveAccountInput,
  type CreateAccountInput,
  type ReplaceSecretInput,
  type SetActiveInput,
  type SetStatusInput,
  type StoredAccountDto,
} from '@dltech/atlas-wire'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { AccountsService } from './accounts.service'

@Router({ alias: 'accounts' })
@UseMiddlewares(SessionMiddleware)
export class AccountsRouter {
  constructor(private readonly accounts: AccountsService) {}

  @Query({ output: z.array(accountDtoSchema) })
  list(@Ctx() ctx: SessionTrpcCtx): Promise<AccountDto[]> {
    return this.accounts.list({ userId: ctx.auth.userId })
  }

  @Mutation({ input: createAccountInputSchema, output: accountDtoSchema })
  create(@Input() input: CreateAccountInput, @Ctx() ctx: SessionTrpcCtx): Promise<AccountDto> {
    return this.accounts.add({ userId: ctx.auth.userId, draft: input })
  }

  @Mutation({ input: setActiveInputSchema, output: z.void() })
  async setActive(@Input() input: SetActiveInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.accounts.setActive({ userId: ctx.auth.userId, draft: input })
  }

  @Query({ input: activeAccountInputSchema, output: activeAccountDtoSchema })
  active(
    @Input() input: ActiveAccountInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<ActiveAccountDto> {
    return this.accounts.activeFor({ userId: ctx.auth.userId, provider: input.provider })
  }

  @Query({ input: accountIdInputSchema, output: storedAccountDtoSchema })
  get(@Input() input: AccountIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<StoredAccountDto> {
    return this.accounts.read({ userId: ctx.auth.userId, accountId: input.accountId })
  }

  @Mutation({ input: replaceSecretInputSchema, output: z.void() })
  async replaceSecret(
    @Input() input: ReplaceSecretInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await this.accounts.replaceSecret({
      userId: ctx.auth.userId,
      accountId: input.accountId,
      secret: input.secret,
    })
  }

  @Mutation({ input: setStatusInputSchema, output: z.void() })
  async setStatus(@Input() input: SetStatusInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.accounts.setStatus({
      userId: ctx.auth.userId,
      accountId: input.accountId,
      status: input.status,
    })
  }

  @Mutation({ input: accountIdInputSchema, output: z.void() })
  async remove(@Input() input: AccountIdInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    await this.accounts.remove({ userId: ctx.auth.userId, accountId: input.accountId })
  }
}
