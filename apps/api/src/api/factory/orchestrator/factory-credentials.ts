import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { EAccountOrigin, EAccountStatus, EAuthKind } from '../../accounts/accounts.types'
import { isUniqueViolation } from '../unique-violation'

const DEFAULT_PROVIDER = 'anthropic'
const POINTER_UNIQUE_TARGET = ['userId', 'provider'] as const

export class FactoryCredentialsNotConfigured extends Error {
  constructor(provider: string) {
    super(
      `the factory identity has no ${provider} credentials — set FACTORY_MODEL_API_KEY so the orchestrator can run turns`,
    )
    this.name = 'FactoryCredentialsNotConfigured'
  }
}

/**
 * The factory system user owns no sign-in flow, so its model credentials arrive as an API key in
 * the tier env and are sealed into the same agent-account store the broker already serves. The
 * serve session in the orchestrator sandbox then resolves them like any other user's.
 */
@Injectable()
export class FactoryCredentialService {
  private seeded: Promise<void> | null = null

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
  ) {}

  ensureSeeded(args: { userId: string }): Promise<void> {
    this.seeded ??= this.seed(args).catch((failure: unknown) => {
      this.seeded = null
      throw failure
    })
    return this.seeded
  }

  private provider(): string {
    return this.env.get('FACTORY_MODEL_PROVIDER') ?? DEFAULT_PROVIDER
  }

  private async seed(args: { userId: string }): Promise<void> {
    const provider = this.provider()
    const existing = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider } },
    })
    if (existing !== null) return

    const apiKey = this.env.get('FACTORY_MODEL_API_KEY')
    if (apiKey === undefined || apiKey.length === 0) {
      throw new FactoryCredentialsNotConfigured(provider)
    }

    const account = await db.agentAccount.create({
      data: {
        id: `acc_${randomUUID()}`,
        provider,
        kind: EAuthKind.ApiKey,
        origin: EAccountOrigin.Environment,
        label: 'factory orchestrator',
        status: EAccountStatus.Active,
        email: null,
        subscription: null,
        importedFrom: null,
        sealedSecret: this.cipher.encrypt(JSON.stringify({ kind: EAuthKind.ApiKey, apiKey })),
        userId: args.userId,
      },
    })

    try {
      await db.activeAccount.create({
        data: { userId: args.userId, provider, accountId: account.id },
      })
    } catch (error) {
      if (!isUniqueViolation(error, POINTER_UNIQUE_TARGET)) throw error
      await db.agentAccount.delete({ where: { id: account.id } })
    }
  }
}
