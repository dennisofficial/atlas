import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { db } from '../../../db'
import type { CloudSandboxModel } from '../../../db'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { ownedSandbox } from './ownership'
import { toSandboxDto } from './rows'
import { claimSandboxRow } from './sandbox-claim'
import { sandboxStateOf } from './sandbox-lifecycle'
import { SandboxEndpointService } from './sandbox-endpoint'
import { registerSandbox, type RegisterSandboxArgs } from './sandbox-register'
import { findOrCreateClaimThread } from './sandbox-thread'
import { hashSessionToken, mintSessionToken, tokenMatches } from './sandbox-tokens'
import type { SandboxAttachmentDto, SandboxListEntryDto, SandboxStatusDto } from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'
import { SANDBOX_REGION, VercelSandboxClient } from './vercel-sandbox.client'
import { ETokenPrincipalKind, type TokenPrincipal } from './token-principal'

const nowIso = (): string => new Date().toISOString()
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class SandboxesService {
  private readonly logger = new Logger(SandboxesService.name)

  private readonly endpoints: SandboxEndpointService

  constructor(
    private readonly vercel: VercelSandboxClient,
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
      ...(args.gitToken === undefined
        ? {}
        : { sealedGitToken: this.cipher.encrypt(args.gitToken) }),
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

  async verifyTokenPrincipal(args: { token: string }): Promise<TokenPrincipal> {
    const tokenHash = hashSessionToken(args.token)
    const [sandbox, pod] = await Promise.all([
      db.cloudSandbox.findFirst({
        where: { tokenHash },
        select: { id: true, threadId: true, userId: true },
      }),
      db.localPodLease.findUnique({
        where: { tokenHash },
        select: { threadId: true, userId: true },
      }),
    ])
    if (sandbox !== null && pod === null) return { kind: ETokenPrincipalKind.Sandbox, ...sandbox }
    if (pod !== null && sandbox === null) return { kind: ETokenPrincipalKind.Pod, ...pod }
    throw new UnauthorizedException('a valid sandbox session token is required')
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

  async park(args: {
    row: Pick<CloudSandboxModel, 'threadId' | 'name'>
    reason: string
  }): Promise<void> {
    await this.notifyParked(args)
    await this.vercel.stop({ threadId: args.row.threadId, name: args.row.name })
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
      await this.vercel.notifyParked({
        threadId: args.row.threadId,
        name: args.row.name,
        reason: args.reason,
      })
    } catch (failure) {
      this.logger.warn(
        `could not notify sandbox ${args.row.name} before parking it: ${messageOf(failure)}`,
      )
    }
  }
}
