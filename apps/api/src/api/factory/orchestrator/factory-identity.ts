import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db } from '../../../db'

export const FACTORY_USER_EMAIL = 'factory@atlas.internal'
export const FACTORY_USER_NAME = 'Atlas Factory'

const emailFor = (organizationId: string | null): string =>
  organizationId === null ? FACTORY_USER_EMAIL : `factory+${organizationId}@atlas.internal`

@Injectable()
export class FactoryIdentityService {
  private promised = new Map<string, Promise<string>>()

  constructor(private readonly cipher: SecretCipherService) {}

  userId(args: { organizationId: string | null }): Promise<string> {
    const email = emailFor(args.organizationId)
    const cached = this.promised.get(email)
    if (cached !== undefined) return cached
    const ensuring = this.ensure({ email }).catch((failure: unknown) => {
      if (this.promised.get(email) === ensuring) this.promised.delete(email)
      throw failure
    })
    this.promised.set(email, ensuring)
    return ensuring
  }

  /**
   * Write the org's decision-model token onto this identity's own secret store as
   * decisions.token. The serve process inside a factory sandbox warms that name through the
   * thread-scoped broker, which resolves secrets by the sandbox's owning user — this identity —
   * so the token reaches the session without ever touching an env var or a settings file.
   * Writing here, with the identity, keeps the factory layer off cloud/secrets.
   */
  async setDecisionsToken(args: {
    organizationId: string | null
    token: string
  }): Promise<void> {
    const userId = await this.userId({ organizationId: args.organizationId })
    const sealedValue = this.cipher.encrypt(JSON.stringify(args.token))
    await db.secretEntry.upsert({
      where: { userId_name: { userId, name: 'decisions.token' } },
      create: { id: `sec_${randomUUID()}`, name: 'decisions.token', sealedValue, userId },
      update: { sealedValue },
    })
  }

  private async ensure(args: { email: string }): Promise<string> {
    const user = await db.user.upsert({
      where: { email: args.email },
      create: {
        id: `usr_${randomUUID()}`,
        name: FACTORY_USER_NAME,
        email: args.email,
      },
      update: {},
    })
    return user.id
  }
}
