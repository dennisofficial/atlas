import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import { SecretCipherService } from '../../_lib/crypto/secret-cipher.service'
import type { CloudSandboxModel, ThreadModel } from '../../db'
import { db } from '../../db'
import { assertArchiveWithinLimit } from '../context-archive/context-archive-limits'
import { CONTEXT_ARCHIVE_STORE } from '../context-archive/context-archive.store'
import type { ContextArchiveStore } from '../context-archive/context-archive.store'
import { SandboxGitCredentials } from './git-credentials'
import { ownedThread } from '../sessions/ownership'
import { ownedSandbox } from './ownership'
import { toSandboxDto, type SandboxPrincipal, type SandboxStatusColumns } from './rows'
import { claimSandboxRow, type ClaimedSandbox } from './sandbox-claim'
import { sandboxNameFor } from './sandbox-names'
import { sessionCredentialOf } from './sandbox-session-credential'
import { hashSessionToken, tokenMatches } from './sandbox-tokens'
import type {
  SandboxAttachmentDto,
  SandboxExposureDto,
  SandboxStatusDto,
  SandboxWorkspaceDto,
  SandboxWorkspaceSpec,
} from './sandboxes.types'
import { ESandboxDriveMode, ESandboxState } from './sandboxes.types'
import {
  SANDBOX_REGION,
  SandboxMissingError,
  VercelSandboxClient,
  type SandboxObservation,
} from './vercel-sandbox.client'
import { assertContextBundleWithinLimit, assertPatchWithinLimit, workspaceSpecOf } from './workspace-spec'

const MINUTE_MS = 60_000

const nowIso = (): string => new Date().toISOString()
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

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
  private readonly sessionClockExtendedAt = new Map<string, number>()

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly env: EnvService,
    private readonly gitCredentials: SandboxGitCredentials,
    private readonly cipher: SecretCipherService,
    @Inject(CONTEXT_ARCHIVE_STORE) private readonly archives: ContextArchiveStore,
  ) {}

  /**
   * The response awaits nothing but the ownership check: a cold image pull can take minutes, long
   * enough for the DigitalOcean edge to 504 while the provision keeps running server-side and its
   * answer is lost. The session credential is resolved up front — reissuing the sandbox's stored
   * token, or minting one the first time — and the claim+provision chain runs in the background
   * under the per-thread lock, so a second attach answers just as fast and simply queues its
   * re-provision behind the first.
   */
  async attach(args: {
    userId: string
    threadId: string
    workspace?: SandboxWorkspaceSpec | undefined
    contextBundle?: string | undefined
    name?: string | undefined
    drive?: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel?: string | undefined
  }): Promise<SandboxAttachmentDto> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    if (args.workspace !== undefined) assertPatchWithinLimit({ patch: args.workspace.patch })
    if (args.contextBundle !== undefined) {
      assertContextBundleWithinLimit({ bundle: args.contextBundle })
    }
    const existing = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { name: true, sealedToken: true },
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

    const previous = this.attachLocks.get(args.threadId) ?? Promise.resolve()
    const chain = () =>
      this.claimAndProvision({
        thread,
        workspace: args.workspace,
        contextBundle: args.contextBundle,
        token: credential.token,
        tokenHash: credential.tokenHash,
        sealedToken: credential.sealedToken,
        rotated: credential.rotated,
        name,
        drive: args.drive,
        pinnedModel: args.pinnedModel,
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
      token: credential.token,
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

  private async claimAndProvision(args: {
    thread: ThreadModel
    workspace: SandboxWorkspaceSpec | undefined
    contextBundle: string | undefined
    token: string
    tokenHash: string
    sealedToken: string
    rotated: boolean
    name: string | undefined
    drive: { name: string; mode: ESandboxDriveMode } | undefined
    pinnedModel: string | undefined
  }): Promise<void> {
    this.provisionFailures.delete(args.thread.id)
    try {
      const row = await claimSandboxRow({
        thread: args.thread,
        tokenHash: args.tokenHash,
        sealedToken: args.sealedToken,
        rotated: args.rotated,
        workspace: args.workspace,
        contextBundle: args.contextBundle,
        name: args.name,
        drive: args.drive,
        pinnedModel: args.pinnedModel,
      })
      await this.provisionInBackground({ row, token: args.token })
    } catch (failure) {
      this.logger.warn(`sandbox attach failed for thread ${args.thread.id}: ${messageOf(failure)}`)
      this.provisionFailures.set(args.thread.id, messageOf(failure))
    }
  }

  /**
   * Answered to the sandbox rather than pushed into its environment: a patch outgrows what a
   * process environment will carry. The git credential is read per request and never stored on the
   * sandbox row.
   */
  async workspace(args: { threadId: string }): Promise<SandboxWorkspaceDto> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: {
        userId: true,
        threadId: true,
        workspaceRemoteUrl: true,
        workspaceBranch: true,
        workspaceCommit: true,
        workspacePatch: true,
        workspaceContext: true,
        workspaceSkills: true,
        workspaceProjectDirectory: true,
      },
    })
    if (row === null) throw new NotFoundException('sandbox not found')
    const spec = workspaceSpecOf(row)
    // workspaceSkills is the outgoing column: a row written between this deploy's PRE_DEPLOY
    // migration and its container swap still carries only workspaceSkills.
    const contextBundle = row.workspaceContext ?? row.workspaceSkills ?? null
    if (spec.remoteUrl === null) return { ...spec, githubToken: null, contextBundle }
    const githubToken = await this.gitCredentials.findToken({
      userId: row.userId,
      threadId: row.threadId,
      remoteUrl: spec.remoteUrl,
    })
    return { ...spec, githubToken, contextBundle }
  }

  async putContextArchive(args: {
    userId: string
    threadId: string
    archive: Buffer
  }): Promise<void> {
    await ownedSandbox({ userId: args.userId, threadId: args.threadId })
    assertArchiveWithinLimit({ bytes: args.archive.byteLength })
    await this.archives.writeSandboxArchive({ threadId: args.threadId, archive: args.archive })
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

  async expose(args: { threadId: string; port: number }): Promise<SandboxExposureDto> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { name: true },
    })
    if (row === null) throw new NotFoundException('sandbox not found')
    try {
      const url = await this.vercel.exposePort({ name: row.name, port: args.port })
      return { threadId: args.threadId, port: args.port, url }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) throw new NotFoundException('sandbox not found')
      throw failure
    }
  }

  async stop(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    await this.park({ row, reason: 'the sandbox was stopped' })
    return { ...toSandboxDto(row), state: ESandboxState.Parked }
  }

  async verifySessionToken(args: { threadId: string; token: string }): Promise<void> {
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { tokenHash: true },
    })
    if (row === null || !tokenMatches({ token: args.token, tokenHash: row.tokenHash })) {
      throw new UnauthorizedException('a valid sandbox session token is required')
    }
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

  async heartbeat(args: { threadId: string }): Promise<void> {
    const at = nowIso()
    await db.cloudSandbox.updateMany({
      where: { threadId: args.threadId },
      data: { lastActivityAt: at, updatedAt: at },
    })
    if (!this.sessionClockDue(args.threadId)) return
    const row = await db.cloudSandbox.findUnique({
      where: { threadId: args.threadId },
      select: { name: true },
    })
    if (row === null) return
    await this.extendSessionClock({ threadId: args.threadId, name: row.name })
  }

  private sessionClockDue(threadId: string): boolean {
    const extendedAt = this.sessionClockExtendedAt.get(threadId)
    return extendedAt === undefined || Date.now() - extendedAt >= this.ttlMs() / 2
  }

  private async extendSessionClock(args: { threadId: string; name: string }): Promise<void> {
    this.sessionClockExtendedAt.set(args.threadId, Date.now())
    try {
      await this.vercel.extendTimeout({ name: args.name, durationMs: this.ttlMs() })
    } catch (failure) {
      this.logger.warn(
        `could not extend the session clock of sandbox ${args.name}: ${messageOf(failure)}`,
      )
    }
  }

  async reap(): Promise<number> {
    const quietSince = new Date(Date.now() - this.ttlMs()).toISOString()
    const stale = await db.cloudSandbox.findMany({
      where: {
        state: { notIn: [ESandboxState.Parked] },
        lastActivityAt: { lt: quietSince },
      },
      select: { threadId: true, name: true },
    })

    let parked = 0
    for (const row of stale) {
      try {
        const fresh = await db.cloudSandbox.findUnique({
          where: { threadId: row.threadId },
          select: { lastActivityAt: true },
        })
        if (fresh === null || fresh.lastActivityAt >= quietSince) continue
        await this.park({ row, reason: 'the sandbox parked after sitting idle' })
        parked += 1
      } catch (failure) {
        this.logger.warn(`could not park sandbox ${row.name}: ${String(failure)}`)
      }
    }
    return parked
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
    return this.env.get('SANDBOX_TTL_MINUTES') * MINUTE_MS
  }

  private async provisionInBackground(args: {
    row: ClaimedSandbox
    token: string
  }): Promise<void> {
    try {
      const drive = driveOf(args.row)
      const placement = await this.vercel.getOrCreate({
        name: args.row.name,
        threadId: args.row.threadId,
        token: args.token,
        ...(drive === undefined ? {} : { drive }),
        ...(args.row.pinnedModel === null ? {} : { pinnedModel: args.row.pinnedModel }),
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
    placement: { sessionId: string; state: ESandboxState }
  }): Promise<void> {
    const at = nowIso()
    await db.cloudSandbox.update({
      where: { threadId: args.row.threadId },
      select: { threadId: true },
      data: {
        sandboxId: args.placement.sessionId,
        state: args.placement.state,
        lastActivityAt: at,
        updatedAt: at,
      },
    })
  }
}
