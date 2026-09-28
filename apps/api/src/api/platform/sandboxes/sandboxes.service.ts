import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import type { CloudSandboxModel } from '../../../db'
import { db } from '../../../db'
import { assertArchiveWithinLimit } from '../../cloud/context-archive/context-archive-limits'
import { CONTEXT_ARCHIVE_STORE } from '../../cloud/context-archive/context-archive.store'
import type { ContextArchiveStore } from '../../cloud/context-archive/context-archive.store'
import { SandboxGitCredentials } from './git-credentials'
import { ownedSandbox } from './ownership'
import { sandboxStateOf, toSandboxDto, type SandboxPrincipal } from './rows'
import { claimSandboxRow } from './sandbox-claim'
import { findOrCreateClaimThread } from './sandbox-thread'
import { hashSessionToken, mintSessionToken, tokenMatches } from './sandbox-tokens'
import type {
  SandboxAttachmentDto,
  SandboxListEntryDto,
  SandboxStatusDto,
  SandboxWorkspaceDto,
  SandboxWorkspaceSpec,
} from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'
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

@Injectable()
export class SandboxesService {
  private readonly logger = new Logger(SandboxesService.name)

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly gitCredentials: SandboxGitCredentials,
    private readonly cipher: SecretCipherService,
    @Inject(CONTEXT_ARCHIVE_STORE) private readonly archives: ContextArchiveStore,
  ) {}

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
    driveName?: string | null | undefined
    contextPending?: boolean | undefined
  }): Promise<SandboxAttachmentDto> {
    const thread = await findOrCreateClaimThread({
      db,
      userId: args.userId,
      threadId: args.threadId,
      ...(typeof args.workspace?.projectDirectory === 'string'
        ? { workspace: args.workspace.projectDirectory }
        : {}),
    })
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
      ...(args.driveName === undefined ? {} : { driveName: args.driveName }),
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

  async list(args: { userId: string }): Promise<SandboxListEntryDto[]> {
    const rows = await db.cloudSandbox.findMany({
      where: { userId: args.userId },
      orderBy: { lastActivityAt: 'desc' },
    })
    return rows.map((row) => ({
      threadId: row.threadId,
      name: row.name,
      driveName: row.driveName ?? null,
      state: sandboxStateOf(row.state),
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

  async putTranscriptArchive(args: {
    userId: string
    threadId: string
    archive: Buffer
  }): Promise<void> {
    await ownedSandbox({ userId: args.userId, threadId: args.threadId })
    assertArchiveWithinLimit({ bytes: args.archive.byteLength })
    await this.archives.writeSandboxTranscript({ threadId: args.threadId, archive: args.archive })
  }

  getTranscriptArchive(args: { threadId: string }): Promise<Buffer | null> {
    return this.archives.readSandboxTranscript({ threadId: args.threadId })
  }

  async status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
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

}
