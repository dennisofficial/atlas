import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ESshSigningKeyState,
  GITHUB_NOT_CONNECTED_CODE,
  SSH_SIGNING_SCOPE_MISSING_CODE,
  SSH_SIGNING_SCOPE_NOTICE,
  type SshSigningKeyLease,
  type SshSigningKeyStatus,
} from '@dltech/atlas-wire'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { db } from '../../../db'
import { hasSigningScope } from '../github/github-scopes'
import { GithubService } from '../github/github.service'
import { isUniqueViolation } from '../github/unique-violation'
import { GithubSigningKeysClient, SigningScopeMissing } from './github-signing-keys.client'
import { publicKeyLineOf } from './openssh-key'

interface Registration {
  token: string
  keyId: number
  created: boolean
  userName: string
  userEmail: string
}

const scopeMissing = (): ForbiddenException =>
  new ForbiddenException({
    message: SSH_SIGNING_SCOPE_NOTICE,
    code: SSH_SIGNING_SCOPE_MISSING_CODE,
  })

const alreadyRegistered = (): ConflictException =>
  new ConflictException('a signing key is already registered')

@Injectable()
export class SshSigningKeyService {
  constructor(
    private readonly cipher: SecretCipherService,
    private readonly github: GithubService,
    private readonly client: GithubSigningKeysClient,
  ) {}

  async status(args: { userId: string }): Promise<SshSigningKeyStatus> {
    const row = await db.sshSigningKey.findUnique({ where: { userId: args.userId } })
    if (row === null) return { state: ESshSigningKeyState.Absent }
    return {
      state: ESshSigningKeyState.Registered,
      publicKey: row.publicKey,
      createdAt: row.createdAt.toISOString(),
    }
  }

  async register(args: { userId: string; privateKey: string }): Promise<SshSigningKeyStatus> {
    const publicKey = publicKeyLineOf({ privateKey: args.privateKey })
    const existing = await db.sshSigningKey.findUnique({ where: { userId: args.userId } })
    if (existing !== null) throw alreadyRegistered()
    const registration = await this.registerOnGithub({ userId: args.userId, publicKey })
    try {
      await db.sshSigningKey.create({
        data: {
          userId: args.userId,
          publicKey,
          sealedPrivateKey: this.cipher.encrypt(args.privateKey),
          githubKeyId: BigInt(registration.keyId),
          userName: registration.userName,
          userEmail: registration.userEmail,
        },
      })
    } catch (error) {
      await this.removeIfCreated(registration)
      if (isUniqueViolation(error, ['userId'])) throw alreadyRegistered()
      throw error
    }
    return this.status({ userId: args.userId })
  }

  async rotate(args: { userId: string; privateKey: string }): Promise<SshSigningKeyStatus> {
    const publicKey = publicKeyLineOf({ privateKey: args.privateKey })
    const existing = await db.sshSigningKey.findUnique({ where: { userId: args.userId } })
    if (existing === null) throw new NotFoundException('no signing key is registered')
    const oldKeyId = Number(existing.githubKeyId)
    const registration = await this.registerOnGithub({ userId: args.userId, publicKey })
    const swapped = await this.swapRow({
      existing,
      registration,
      publicKey,
      privateKey: args.privateKey,
    })
    if (!swapped) {
      await this.removeIfCreated(registration)
      throw new ConflictException('the signing key changed concurrently; retry')
    }
    if (oldKeyId !== registration.keyId) {
      await this.removeBestEffort({ token: registration.token, keyId: oldKeyId })
    }
    return this.status({ userId: args.userId })
  }

  async revoke(args: { userId: string }): Promise<void> {
    const row = await db.sshSigningKey.findUnique({ where: { userId: args.userId } })
    if (row === null) return
    await db.sshSigningKey.deleteMany({
      where: { userId: args.userId, githubKeyId: row.githubKeyId },
    })
    const credentials = await this.github
      .findCredentials({ userId: args.userId })
      .catch(() => undefined)
    if (credentials === undefined) return
    await this.removeBestEffort({ token: credentials.token, keyId: Number(row.githubKeyId) })
  }

  async lease(args: { userId: string }): Promise<SshSigningKeyLease> {
    const row = await db.sshSigningKey.findUnique({ where: { userId: args.userId } })
    if (row === null) throw new NotFoundException('no signing key is registered')
    return {
      publicKey: row.publicKey,
      privateKey: this.cipher.decrypt(row.sealedPrivateKey),
      userName: row.userName,
      userEmail: row.userEmail,
    }
  }

  private async registerOnGithub(args: {
    userId: string
    publicKey: string
  }): Promise<Registration> {
    const credentials = await this.github.findCredentials({ userId: args.userId })
    if (credentials === undefined) {
      throw new ConflictException({
        message: 'connect GitHub in settings first',
        code: GITHUB_NOT_CONNECTED_CODE,
      })
    }
    if (!hasSigningScope(credentials.scopes)) throw scopeMissing()
    try {
      const { id, login } = await this.client.identity({ token: credentials.token })
      const { id: keyId, created } = await this.client.register({
        token: credentials.token,
        key: args.publicKey,
        title: `Atlas (${login})`,
      })
      return {
        token: credentials.token,
        keyId,
        created,
        userName: login,
        userEmail: `${id}+${login}@users.noreply.github.com`,
      }
    } catch (error) {
      if (error instanceof SigningScopeMissing) throw scopeMissing()
      throw error
    }
  }

  private async swapRow(args: {
    existing: { userId: string; githubKeyId: bigint }
    registration: Registration
    publicKey: string
    privateKey: string
  }): Promise<boolean> {
    try {
      const { count } = await db.sshSigningKey.updateMany({
        where: { userId: args.existing.userId, githubKeyId: args.existing.githubKeyId },
        data: {
          publicKey: args.publicKey,
          sealedPrivateKey: this.cipher.encrypt(args.privateKey),
          githubKeyId: BigInt(args.registration.keyId),
          userName: args.registration.userName,
          userEmail: args.registration.userEmail,
        },
      })
      return count > 0
    } catch (error) {
      await this.removeIfCreated(args.registration)
      throw error
    }
  }

  private async removeIfCreated(registration: Registration): Promise<void> {
    if (!registration.created) return
    await this.removeBestEffort({ token: registration.token, keyId: registration.keyId })
  }

  private async removeBestEffort(args: { token: string; keyId: number }): Promise<void> {
    try {
      await this.client.remove(args)
    } catch {
      return
    }
  }
}
