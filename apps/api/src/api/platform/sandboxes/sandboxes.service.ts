import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { db } from '../../../db'
import type { CloudSandboxModel } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { SandboxGitCredentials } from './git-credentials'
import { ownedSandbox } from './ownership'
import { toSandboxDto, type SandboxPrincipal } from './rows'
import { claimSandboxRow } from './sandbox-claim'
import { sandboxStateOf } from './sandbox-lifecycle'
import { SandboxEndpointService } from './sandbox-endpoint'
import { registerSandbox, type RegisterSandboxArgs } from './sandbox-register'
import { findOrCreateClaimThread } from './sandbox-thread'
import { hashSessionToken, mintSessionToken, tokenMatches } from './sandbox-tokens'
import type {
  SandboxAttachmentDto,
  SandboxListEntryDto,
  SandboxStatusDto,
  SandboxWorkspaceDto,
} from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'
import { SANDBOX_REGION, VercelSandboxClient } from './vercel-sandbox.client'
import { workspaceSpecOf } from './workspace-spec'

const nowIso = (): string => new Date().toISOString()
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class SandboxesService {
  private readonly logger = new Logger(SandboxesService.name)

  private readonly endpoints: SandboxEndpointService

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly gitCredentials: SandboxGitCredentials,
    private readonly cipher: SecretCipherService,
  ) {
    this.endpoints = new SandboxEndpointService(vercel, cipher)
  }

  /**
   * The rendezvous half of a BYO lift: the harness drives Vercel with the operator's own token,
   * so a claim only writes the row and mints the session credential — nothing here calls Vercel.
   * Every claim mints a fresh session token, and re-seals the git credential that rode up with
   * the claim; a claim that omits it leaves the stored one in place.
   */
  async claim(args: {
    userId: string
    threadId: string
    gitToken?: string | undefined
    gpgKey?: string | undefined
    contextPending?: boolean | undefined
    clientToken?: string | undefined
    serveUrl?: string | undefined
    serveVersion?: string | undefined
    metadata?: { title?: string; repo?: string; model?: string } | undefined
  }): Promise<SandboxAttachmentDto> {
    const clientToken = args.clientToken
    if (clientToken !== undefined) {
      return this.register({
        userId: args.userId,
        threadId: args.threadId,
        clientToken,
        serveUrl: args.serveUrl,
        ...(args.serveVersion === undefined ? {} : { serveVersion: args.serveVersion }),
        ...(args.metadata === undefined ? {} : { metadata: args.metadata }),
      })
    }
    const thread = await findOrCreateClaimThread({
      db,
      userId: args.userId,
      threadId: args.threadId,
    })
    const minted = mintSessionToken()
    const row = await claimSandboxRow({
      thread,
      tokenHash: minted.tokenHash,
      sealedToken: this.cipher.encrypt(minted.token),
      rotated: true,
      ...(args.gitToken === undefined ? {} : { sealedGitToken: this.cipher.encrypt(args.gitToken) }),
      ...(args.gpgKey === undefined ? {} : { sealedGpgKey: this.cipher.encrypt(args.gpgKey) }),
      ...(args.contextPending === undefined ? {} : { contextPending: args.contextPending }),
    })
    return {
      threadId: args.threadId,
      name: row.name,
      region: SANDBOX_REGION,
      state: ESandboxState.Resuming,
      lastActivityAt: nowIso(),
      contextPending: row.contextPending,
      token: minted.token,
    }
  }

  /**
   * The client-provisioned sibling of claim: the client minted its own session token and owns the
   * Vercel deployment end to end, so the API only stores the token's hash (plus a sealed copy for
   * the owner-session reads that answer attachment) and the endpoint the sandbox already serves.
   * Re-registration is idempotent — the stored token never rotates under the client that issued it.
   */
  private register(args: RegisterSandboxArgs): Promise<SandboxAttachmentDto> {
    return registerSandbox({ ...args, cipher: this.cipher })
  }

  runningEndpoint(args: {
    userId: string
    threadId: string
  }): Promise<{ token: string; url: string } | null> {
    return this.endpoints.runningEndpoint(args)
  }

  async list(args: { userId: string }): Promise<SandboxListEntryDto[]> {
    const rows = await db.cloudSandbox.findMany({
      where: { userId: args.userId },
      orderBy: { lastActivityAt: 'desc' },
    })
    return rows.map((row) => ({
      threadId: row.threadId,
      name: row.name,
      state: sandboxStateOf(row),
      lastActivityAt: row.lastActivityAt,
    }))
  }

  /**
   * Answered to the sandbox rather than pushed into its environment: a patch outgrows what a
   * process environment will carry. The git credential rides the claim and sits sealed on the
   * row; a claim without one falls through to the credential broker.
   */
  async workspace(args: { threadId: string }): Promise<SandboxWorkspaceDto> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: {
        userId: true,
        threadId: true,
        name: true,
        sealedGitToken: true,
        workspaceRemoteUrl: true,
      },
    })
    if (row === null) throw new NotFoundException('sandbox not found')
    const spec = workspaceSpecOf(row)
    if (spec.remoteUrl === null) {
      return { ...spec, githubToken: null }
    }
    const claimed = this.claimedGitToken({ name: row.name, sealedGitToken: row.sealedGitToken })
    if (claimed !== null) return { ...spec, githubToken: claimed }
    const githubToken = await this.gitCredentials.findToken({
      userId: row.userId,
      threadId: row.threadId,
      remoteUrl: spec.remoteUrl,
    })
    return { ...spec, githubToken }
  }

  private claimedGitToken(args: {
    name: string
    sealedGitToken: string | null
  }): string | null {
    if (args.sealedGitToken === null) return null
    try {
      return this.cipher.decrypt(args.sealedGitToken)
    } catch (failure) {
      this.logger.warn(
        `the sealed git token on sandbox ${args.name} does not decrypt; the credential broker answers instead: ${messageOf(failure)}`,
      )
      return null
    }
  }

  private claimedGpgKey(args: { name: string; sealedGpgKey: string | null }): string | null {
    if (args.sealedGpgKey === null) return null
    try {
      return this.cipher.decrypt(args.sealedGpgKey)
    } catch (failure) {
      this.logger.warn(
        `the sealed gpg key on sandbox ${args.name} does not decrypt; the sandbox gets none: ${messageOf(failure)}`,
      )
      return null
    }
  }

  status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    return this.endpoints.status(args)
  }

  async stop(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    await this.park({ row, reason: 'the sandbox was stopped' })
    return { ...toSandboxDto(row), state: ESandboxState.Parked }
  }

  /**
   * The harness owns the Vercel side of a BYO sandbox and has already destroyed it by the time it
   * calls destroy; the API only ever owned the row.
   */
  async destroy(args: { userId: string; threadId: string }): Promise<void> {
    await ownedSandbox(args)
    await db.cloudSandbox.delete({ where: { threadId: args.threadId } })
  }

  async verifySessionToken(args: { threadId: string; token: string }): Promise<{ userId: string }> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { tokenHash: true, userId: true },
    })
    if (row === null || !tokenMatches({ token: args.token, tokenHash: row.tokenHash })) {
      throw new UnauthorizedException('a valid sandbox session token is required')
    }
    return { userId: row.userId }
  }

  async verifyTokenPrincipal(args: { token: string }): Promise<SandboxPrincipal> {
    const row = await db.cloudSandbox.findFirst({
      where: { tokenHash: hashSessionToken(args.token) },
      select: { id: true, threadId: true, userId: true },
    })
    if (row === null) throw new UnauthorizedException('a valid sandbox session token is required')
    return row
  }

  /**
   * A sandbox token reaches the conversation it serves: the sandbox's own thread plus the
   * sub-agent threads it spawns (spawnerThreadId points at the root). Sub-agents cannot spawn
   * sub-agents of their own, so the family is exactly one level deep.
   */
  async assertThreadInFamily(args: { sandboxThreadId: string; threadId: string }): Promise<void> {
    if (args.threadId === args.sandboxThreadId) return
    const child = await db.thread.findFirst({
      where: { id: args.threadId, spawnerThreadId: args.sandboxThreadId },
      select: { id: true },
    })
    if (child === null) {
      throw new UnauthorizedException(
        'the sandbox token reaches only its own thread and its sub-agents',
      )
    }
  }

  async park(args: { row: Pick<CloudSandboxModel, 'threadId' | 'name'>; reason: string }): Promise<void> {
    await this.notifyParked(args)
    await this.vercel.stop({ name: args.row.name })
    await db.cloudSandbox.update({
      where: { threadId: args.row.threadId },
      data: { state: ESandboxState.Parked, updatedAt: nowIso() },
    })
  }

  /** Best-effort: a sandbox that cannot be reached must still stop, so every failure is swallowed. */
  private async notifyParked(args: {
    row: Pick<CloudSandboxModel, 'threadId' | 'name'>
    reason: string
  }): Promise<void> {
    try {
      await this.vercel.notifyParked({ name: args.row.name, reason: args.reason })
    } catch (failure) {
      this.logger.warn(
        `could not notify sandbox ${args.row.name} before parking it: ${messageOf(failure)}`,
      )
    }
  }

}
