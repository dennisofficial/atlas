import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { db } from '../../../db'

export const FACTORY_USER_EMAIL = 'factory@atlas.internal'
export const FACTORY_USER_NAME = 'Atlas Factory'

const emailFor = (organizationId: string | null): string =>
  organizationId === null ? FACTORY_USER_EMAIL : `factory+${organizationId}@atlas.internal`

@Injectable()
export class FactoryIdentityService {
  private promised = new Map<string, Promise<string>>()

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
