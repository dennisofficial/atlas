import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { CloudSandboxModel, ThreadModel } from '../../../db'
import { db } from '../../../db'
import { Prisma, type PrismaClient } from '../../../generated/prisma/client'
import { assertArchiveWithinLimit } from '../../cloud/context-archive/context-archive-limits'
import { CONTEXT_ARCHIVE_STORE } from '../../cloud/context-archive/context-archive.store'
import type { ContextArchiveStore } from '../../cloud/context-archive/context-archive.store'
import { SandboxGitCredentials } from './git-credentials'
import { ownedThread } from '../sessions/ownership'
import { ownedSandbox } from './ownership'
import { toSandboxDto, type SandboxPrincipal, type SandboxStatusColumns } from './rows'
import { claimSandboxRow, type ClaimedSandbox } from './sandbox-claim'
import { sandboxNameFor } from './sandbox-names'
import { sessionCredentialOf } from './sandbox-session-credential'
import { hashSessionToken, mintSessionToken, tokenMatches } from './sandbox-tokens'
import type {
  SandboxAttachmentDto,
  SandboxStatusDto,
  SandboxWorkspaceDto,
  SandboxWorkspaceSpec,
} from './sandboxes.types'
import { ESandboxDriveMode, ESandboxFactoryRole, ESandboxState } from './sandboxes.types'
import {
  SANDBOX_REGION,
  SandboxMissingError,
  VercelSandboxClient,
  type SandboxObservation,
} from './vercel-sandbox.client'
import { assertContextBundleWithinLimit, assertPatchWithinLimit, workspaceSpecOf } from './workspace-spec'

const nowIso = (): string => new Date().toISOString()
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/** How often a quota claim retries a serialization abort before surfacing it. */
const MAX_CLAIM_ATTEMPTS = 3

/**
 * P2034 is Prisma's code for a serialization failure or deadlock; the pg driver adapter can
 * also leave the raw SQLSTATE 40001 nested in the error meta. Either shape means the
 * transaction lost a write-skew race and is safe to retry.
 */
const isSerializationFailure = (failure: unknown): boolean => {
  if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) return false
  if (failure.code === 'P2034') return true
  const meta = failure.meta as
    | { driverAdapterError?: { cause?: { code?: unknown } } }
    | undefined
  return meta?.driverAdapterError?.cause?.code === '40001'
}

const driveOf = (
  row: Pick<CloudSandboxModel, 'driveName' | 'driveMode'>,
): { name: string; mode: ESandboxDriveMode } | undefined => {
  if (row.driveName === null) return undefined
  return {
    name: row.driveName,
    mode:
      row.driveMode === ESandboxDriveMode.Snapshot
        ? ESandboxDriveMode.Snapshot
        : ESandboxDriveMode.ReadWrite,
  }
}

@Injectable()
export class SandboxesService {
  private readonly logger = new Logger(SandboxesService.name)
  private readonly attachLocks = new Map<string, Promise<unknown>>()
  private readonly provisionFailures = new Map<string, string>()

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly env: EnvService,
    private readonly gitCredentials: SandboxGitCredentials,
    private readonly cipher: SecretCipherService,
    @Inject(CONTEXT_ARCHIVE_STORE) private readonly archives: ContextArchiveStore,
  ) {}

  /**
   * The response awaits the ownership check and the quota-checked claim — both plain row reads
   * and writes — but never the provision: a cold image pull can take minutes, long enough for
   * the DigitalOcean edge to 504 while the provision keeps running server-side and its answer
   * is lost. The session credential is resolved up front — reissuing the sandbox's stored
   * token, or minting one the first time — and the claim commits in the same serializable
   * transaction as the quota check, so two first attaches on different threads cannot both
   * read a count under the cap and both claim (GH-201); only the provision chain runs in the
   * background under the per-thread lock, so a second attach answers just as fast and simply
   * queues its re-provision behind the first.
   */
  async attach(args: {
    userId: string
    threadId: string
    workspace?: SandboxWorkspaceSpec | undefined
    contextBundle?: string | undefined
    name?: string | undefined
    drive?: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel?: string | undefined
    factoryRole?: ESandboxFactoryRole | undefined
    decisionsUrl?: string | undefined
  }): Promise<SandboxAttachmentDto> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    if (args.workspace !== undefined) assertPatchWithinLimit({ patch: args.workspace.patch })
    if (args.contextBundle !== undefined) {
      assertContextBundleWithinLimit({ bundle: args.contextBundle })
    }
    const existing = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { name: true, sealedToken: true, contextPending: true },
    })
    const name = existing?.name ?? args.name ?? sandboxNameFor({ threadId: args.threadId })
    const credential = sessionCredentialOf({
      cipher: this.cipher,
      sealedToken: existing?.sealedToken ?? null,
      onStaleToken: (failure) =>
        this.logger.warn(
          `the stored sandbox token does not decrypt; minting a fresh one: ${messageOf(failure)}`,
        ),
    })

    const row = await this.claimWithinQuota({
      thread,
      workspace: args.workspace,
      contextBundle: args.contextBundle,
      tokenHash: credential.tokenHash,
      sealedToken: credential.sealedToken,
      rotated: credential.rotated,
      name,
      drive: args.drive,
      pinnedModel: args.pinnedModel,
    })

    const previous = this.attachLocks.get(args.threadId) ?? Promise.resolve()
    const chain = () =>
      this.provisionClaimed({
        threadId: thread.id,
        row,
        token: credential.token,
        factoryRole: args.factoryRole,
        decisionsUrl: args.decisionsUrl,
      })
    const settled = previous.then(chain, chain)
    this.attachLocks.set(args.threadId, settled)
    const cleanup = () => {
      if (this.attachLocks.get(args.threadId) === settled) this.attachLocks.delete(args.threadId)
    }
    void settled.then(cleanup, cleanup)

    return {
      threadId: args.threadId,
      name,
      region: SANDBOX_REGION,
      state: ESandboxState.Resuming,
      lastActivityAt: nowIso(),
      contextPending: existing?.contextPending ?? true,
      token: credential.token,
    }
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
    workspace?: SandboxWorkspaceSpec | undefined
    contextBundle?: string | undefined
    gitToken?: string | undefined
    gpgKey?: string | undefined
    contextPending?: boolean | undefined
  }): Promise<SandboxAttachmentDto> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    if (args.workspace !== undefined) assertPatchWithinLimit({ patch: args.workspace.patch })
    if (args.contextBundle !== undefined) {
      assertContextBundleWithinLimit({ bundle: args.contextBundle })
    }
    const minted = mintSessionToken()
    const row = await claimSandboxRow({
      thread,
      tokenHash: minted.tokenHash,
      sealedToken: this.cipher.encrypt(minted.token),
      rotated: true,
      workspace: args.workspace,
      contextBundle: args.contextBundle,
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
   * A wake against a running sandbox must not re-attach: attach() still calls into Vercel's
   * get-or-create and the serve launcher on every call, so reaching in through the sealed token
   * avoids that round trip entirely for a sandbox already known to be running.
   */
  async runningEndpoint(args: {
    userId: string
    threadId: string
  }): Promise<{ token: string; url: string } | null> {
    const row = await db.cloudSandbox.findFirst({
      where: { threadId: args.threadId, userId: args.userId },
      select: { name: true, sealedToken: true },
    })
    if (row === null || row.sealedToken === null) return null
    let observed: SandboxObservation
    try {
      observed = await this.vercel.inspect({ name: row.name })
    } catch {
      return null
    }
    if (observed.state !== ESandboxState.Running || observed.url === undefined) return null
    let token: string
    try {
      token = this.cipher.decrypt(row.sealedToken)
    } catch (failure) {
      this.logger.warn(
        `the sealed token on sandbox ${row.name} does not decrypt; the next attach re-seals it: ${messageOf(failure)}`,
      )
      return null
    }
    return { token, url: observed.url }
  }

  whenSettled(args: { threadId: string }): Promise<void> {
    const chain = this.attachLocks.get(args.threadId) ?? Promise.resolve()
    return chain.then(() => undefined)
  }

  /**
   * The cap check and the row claim commit in one serializable transaction: under the default
   * isolation two concurrent first attaches on different threads both read an active count
   * under the cap and both claim (GH-201). Serializable makes the loser abort with a
   * serialization failure, and the retry re-reads the winner's fresh row so the cap check
   * refuses it with 429.
   */
  private async claimWithinQuota(args: {
    thread: ThreadModel
    workspace: SandboxWorkspaceSpec | undefined
    contextBundle: string | undefined
    tokenHash: string
    sealedToken: string
    rotated: boolean
    name: string | undefined
    drive: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel: string | undefined
  }): Promise<ClaimedSandbox> {
    let attempt = 0
    for (;;) {
      try {
        return await db.$transaction(
          async (tx) => {
            await this.assertWithinQuota({
              userId: args.thread.userId,
              threadId: args.thread.id,
              reader: tx,
            })
            return claimSandboxRow({ ...args, writer: tx })
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
      } catch (failure) {
        attempt += 1
        if (attempt >= MAX_CLAIM_ATTEMPTS || !isSerializationFailure(failure)) throw failure
      }
    }
  }

  private async provisionClaimed(args: {
    threadId: string
    row: ClaimedSandbox
    token: string
    factoryRole: ESandboxFactoryRole | undefined
    decisionsUrl: string | undefined
  }): Promise<void> {
    this.provisionFailures.delete(args.threadId)
    await this.provisionInBackground({
      row: args.row,
      token: args.token,
      factoryRole: args.factoryRole,
      decisionsUrl: args.decisionsUrl,
    })
  }

  /**
   * Answered to the sandbox rather than pushed into its environment: a patch outgrows what a
   * process environment will carry. The git credential rides the claim and sits sealed on the row;
   * factory station sandboxes claim no git token, so their credential still comes from the broker.
   */
  async workspace(args: { threadId: string }): Promise<SandboxWorkspaceDto> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: {
        userId: true,
        threadId: true,
        name: true,
        sealedGitToken: true,
        sealedGpgKey: true,
        workspaceRemoteUrl: true,
        workspaceBranch: true,
        workspaceCommit: true,
        workspacePatch: true,
        workspaceContext: true,
        workspaceSkills: true,
        workspaceProjectDirectory: true,
        workspaceGitName: true,
        workspaceGitEmail: true,
      },
    })
    if (row === null) throw new NotFoundException('sandbox not found')
    const spec = workspaceSpecOf(row)
    // workspaceSkills is the outgoing column: a row written between this deploy's PRE_DEPLOY
    // migration and its container swap still carries only workspaceSkills.
    const contextBundle = row.workspaceContext ?? row.workspaceSkills ?? null
    const gpgKey = this.claimedGpgKey({ name: row.name, sealedGpgKey: row.sealedGpgKey })
    if (spec.remoteUrl === null) {
      return { ...spec, githubToken: null, gpgKey, contextBundle }
    }
    const claimed = this.claimedGitToken({ name: row.name, sealedGitToken: row.sealedGitToken })
    if (claimed !== null) return { ...spec, githubToken: claimed, gpgKey, contextBundle }
    const githubToken = await this.gitCredentials.findToken({
      userId: row.userId,
      threadId: row.threadId,
      remoteUrl: spec.remoteUrl,
    })
    return { ...spec, githubToken, gpgKey, contextBundle }
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

  async putContextArchive(args: {
    userId: string
    threadId: string
    archive: Buffer
  }): Promise<void> {
    await ownedSandbox({ userId: args.userId, threadId: args.threadId })
    assertArchiveWithinLimit({ bytes: args.archive.byteLength })
    await this.archives.writeSandboxArchive({ threadId: args.threadId, archive: args.archive })
    await db.cloudSandbox.update({
      where: { threadId: args.threadId },
      select: { threadId: true },
      data: { contextPending: false, updatedAt: nowIso() },
    })
  }

  getContextArchive(args: { threadId: string }): Promise<Buffer | null> {
    return this.archives.readSandboxArchive({ threadId: args.threadId })
  }

  async status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const failed = this.provisionFailures.get(args.threadId)
    if (failed !== undefined) throw new BadGatewayException(failed)

    const row = await ownedSandbox(args)
    try {
      const observed = await this.vercel.inspect({ name: row.name })
      return {
        ...toSandboxDto(row),
        state: observed.state,
        ...(observed.url === undefined ? {} : { url: observed.url }),
      }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) return toSandboxDto(row)
      throw failure
    }
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
    this.provisionFailures.delete(args.threadId)
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
      data: { state: ESandboxState.Parked, sealedToken: null, updatedAt: nowIso() },
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

  private ttlMs(): number {
    return this.env.get('SANDBOX_TTL_MINUTES') * 60_000
  }

  /**
   * Every sandbox is billed to the deployment owner, and sign-up is open, so an account may
   * hold only so many recently-active sandboxes at once. "Active" rides on lastActivityAt over
   * one TTL rather than on the state column: a freshly claimed row still reads Parked while its
   * provision runs in the background, but its activity timestamp is already now. The check runs
   * inside the claim's serializable transaction (claimWithinQuota) — on its own it is a
   * check-then-act race that concurrent first attaches on different threads would slip through.
   */
  private async assertWithinQuota(args: {
    userId: string
    threadId: string
    reader: Pick<PrismaClient, 'cloudSandbox'>
  }): Promise<void> {
    const cap = this.env.get('SANDBOX_MAX_ACTIVE_PER_USER')
    const activeSince = new Date(Date.now() - this.ttlMs()).toISOString()
    const rows = await args.reader.cloudSandbox.findMany({
      where: { userId: args.userId, lastActivityAt: { gte: activeSince } },
      select: { threadId: true },
    })
    const active = new Set(rows.map((row) => row.threadId))
    active.add(args.threadId)
    if (active.size > cap) {
      throw new HttpException(
        `this account already has ${active.size - 1} active sandboxes (the limit is ${cap}) — stop one or let it park first`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  private async provisionInBackground(args: {
    row: ClaimedSandbox
    token: string
    factoryRole: ESandboxFactoryRole | undefined
    decisionsUrl: string | undefined
  }): Promise<void> {
    try {
      const drive = driveOf(args.row)
      const placement = await this.vercel.getOrCreate({
        name: args.row.name,
        threadId: args.row.threadId,
        token: args.token,
        ...(drive === undefined ? {} : { drive }),
        ...(args.row.pinnedModel === null ? {} : { pinnedModel: args.row.pinnedModel }),
        ...(args.factoryRole === undefined ? {} : { factoryRole: args.factoryRole }),
        ...(args.decisionsUrl === undefined ? {} : { decisionsUrl: args.decisionsUrl }),
      })
      await this.stamp({ row: args.row, placement })
    } catch (failure) {
      const message = messageOf(failure)
      this.logger.warn(`sandbox provisioning failed for thread ${args.row.threadId}: ${message}`)
      this.provisionFailures.set(args.row.threadId, message)
    }
  }

  private async stamp(args: {
    row: Pick<CloudSandboxModel, 'threadId'>
    placement: { sessionId: string; state: ESandboxState; created: boolean }
  }): Promise<void> {
    const at = nowIso()
    await db.cloudSandbox.update({
      where: { threadId: args.row.threadId },
      select: { threadId: true },
      data: {
        sandboxId: args.placement.sessionId,
        state: args.placement.state,
        contextPending: args.placement.created,
        lastActivityAt: at,
        updatedAt: at,
      },
    })
  }
}
