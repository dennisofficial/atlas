import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { db } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { EAccountOrigin, EAccountStatus, EAuthKind } from '../../platform/accounts/accounts.types'
import { type ModelCredentialBlob } from '../settings/org-credential-blobs'
import { OrgSettingsService } from '../settings/org-settings.service'
import { isUniqueViolation } from '../unique-violation'

const DEFAULT_PROVIDER = 'anthropic'
export const DEFAULT_FACTORY_MODEL_REF = 'inference/kimi-k3-fast'
const POINTER_UNIQUE_TARGET = ['userId', 'provider'] as const

export class FactoryCredentialsNotConfigured extends Error {
  constructor(provider: string) {
    super(
      `the factory identity has no ${provider} credentials — set FACTORY_MODEL_API_KEY or store a model credential on the org settings page so the orchestrator can run turns`,
    )
    this.name = 'FactoryCredentialsNotConfigured'
  }
}

/**
 * The factory system user owns no sign-in flow, so its model credentials arrive either as an API
 * key in the tier env or as a model credential the org stored on its settings page; both are
 * sealed into the same agent-account store the broker already serves. The serve session in the
 * orchestrator sandbox then resolves them like any other user's.
 */
@Injectable()
export class FactoryCredentialService {
  private seeded = new Map<string, Promise<void>>()

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    private readonly settings: OrgSettingsService,
  ) {}

  ensureSeeded(args: { userId: string; organizationId: string | null }): Promise<void> {
    if (args.organizationId !== null) return this.seed(args)
    const cached = this.seeded.get(args.userId)
    if (cached !== undefined) return cached
    const seeding = this.seed(args).catch((failure: unknown) => {
      if (this.seeded.get(args.userId) === seeding) this.seeded.delete(args.userId)
      throw failure
    })
    this.seeded.set(args.userId, seeding)
    return seeding
  }

  private envProvider(): string {
    return this.env.get('FACTORY_MODEL_PROVIDER') ?? DEFAULT_PROVIDER
  }

  /**
   * The model every factory sandbox launches on (ATLAS_MODEL in its environment). It is the
   * launch-level default for the session — it outranks the settings file, and nothing pins a
   * session against a later switch.
   */
  async modelRef(args: { organizationId: string | null }): Promise<string> {
    const blob = await this.orgCredential(args)
    if (blob !== null) return blob.modelRef
    return this.env.get('FACTORY_MODEL_ID') ?? DEFAULT_FACTORY_MODEL_REF
  }

  /**
   * The decision-model endpoint the org configured (ATLAS_DECISIONS_URL in the sandbox's
   * environment), or undefined when the org has none — the session then keeps the generative
   * judge. The decisions token is not carried here: it is a Secret-kind setting the serve
   * process reads through the thread-scoped broker, and it lands on the factory identity's own
   * secret store when the org saves its decisions credential (OrgSettingsService.putDecisions).
   */
  async decisionsUrl(args: { organizationId: string | null }): Promise<string | undefined> {
    if (args.organizationId === null) return undefined
    const blob = await this.settings.readDecisionsCredential({ organizationId: args.organizationId })
    return blob?.url
  }

  private async orgCredential(args: {
    organizationId: string | null
  }): Promise<ModelCredentialBlob | null> {
    if (args.organizationId === null) return null
    return this.settings.readModelCredential({ organizationId: args.organizationId })
  }

  private envApiKey(args: { provider: string }): string {
    const apiKey = this.env.get('FACTORY_MODEL_API_KEY')
    if (apiKey === undefined || apiKey.length === 0) {
      throw new FactoryCredentialsNotConfigured(args.provider)
    }
    return apiKey
  }

  private async seed(args: { userId: string; organizationId: string | null }): Promise<void> {
    const blob = await this.orgCredential(args)
    if (blob !== null) return this.seedFromBlob({ userId: args.userId, blob })
    return this.seedFromEnv({ userId: args.userId })
  }

  private async seedFromEnv(args: { userId: string }): Promise<void> {
    const provider = this.envProvider()
    const existing = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider } },
    })
    if (existing !== null) return

    const account = await this.createAccount({
      userId: args.userId,
      provider,
      apiKey: this.envApiKey({ provider }),
    })
    await this.pointAt({ userId: args.userId, provider, accountId: account.id })
  }

  private async seedFromBlob(args: {
    userId: string
    blob: ModelCredentialBlob
  }): Promise<void> {
    const existing = await db.activeAccount.findUnique({
      where: { userId_provider: { userId: args.userId, provider: args.blob.provider } },
    })
    if (existing === null) {
      const account = await this.createAccount({
        userId: args.userId,
        provider: args.blob.provider,
        apiKey: args.blob.apiKey,
      })
      await this.pointAt({ userId: args.userId, provider: args.blob.provider, accountId: account.id })
      return
    }

    const account = await db.agentAccount.findUnique({ where: { id: existing.accountId } })
    if (
      account !== null &&
      this.sealedKeyMatches({ sealedSecret: account.sealedSecret, apiKey: args.blob.apiKey })
    ) {
      return
    }
    const replacement = await this.createAccount({
      userId: args.userId,
      provider: args.blob.provider,
      apiKey: args.blob.apiKey,
    })
    await db.activeAccount.update({
      where: { userId_provider: { userId: args.userId, provider: args.blob.provider } },
      data: { accountId: replacement.id },
    })
  }

  private sealedKeyMatches(args: { sealedSecret: string; apiKey: string }): boolean {
    try {
      const secret = JSON.parse(this.cipher.decrypt(args.sealedSecret)) as { apiKey?: unknown }
      return secret.apiKey === args.apiKey
    } catch {
      return false
    }
  }

  private createAccount(args: { userId: string; provider: string; apiKey: string }) {
    return db.agentAccount.create({
      data: {
        id: `acc_${randomUUID()}`,
        provider: args.provider,
        kind: EAuthKind.ApiKey,
        origin: EAccountOrigin.Environment,
        label: 'factory orchestrator',
        status: EAccountStatus.Active,
        email: null,
        subscription: null,
        importedFrom: null,
        sealedSecret: this.cipher.encrypt(
          JSON.stringify({ kind: EAuthKind.ApiKey, apiKey: args.apiKey }),
        ),
        userId: args.userId,
      },
    })
  }

  private async pointAt(args: {
    userId: string
    provider: string
    accountId: string
  }): Promise<void> {
    try {
      await db.activeAccount.create({
        data: { userId: args.userId, provider: args.provider, accountId: args.accountId },
      })
    } catch (error) {
      if (!isUniqueViolation(error, POINTER_UNIQUE_TARGET)) throw error
      await db.agentAccount.delete({ where: { id: args.accountId } })
    }
  }
}
