import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { db } from '../../../db'

export const FACTORY_USER_EMAIL = 'factory@atlas.internal'
export const FACTORY_USER_NAME = 'Atlas Factory'

@Injectable()
export class FactoryIdentityService {
  private promised: Promise<string> | null = null

  userId(): Promise<string> {
    this.promised ??= this.ensure().catch((failure: unknown) => {
      this.promised = null
      throw failure
    })
    return this.promised
  }

  private async ensure(): Promise<string> {
    const user = await db.user.upsert({
      where: { email: FACTORY_USER_EMAIL },
      create: {
        id: `usr_${randomUUID()}`,
        name: FACTORY_USER_NAME,
        email: FACTORY_USER_EMAIL,
      },
      update: {},
    })
    return user.id
  }
}
