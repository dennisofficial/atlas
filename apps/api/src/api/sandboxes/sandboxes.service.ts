import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'
import type { CloudSandboxModel, ThreadModel } from '../../db'
import { db } from '../../db'
import { GithubService } from '../github/github.service'
import { ownedThread } from '../sessions/ownership'
import { ownedSandbox } from './ownership'
import { toSandboxDto } from './rows'
import { sandboxNameFor } from './sandbox-names'
import { mintSessionToken, tokenMatches } from './sandbox-tokens'
import type {
  SandboxAttachmentDto,
  SandboxStatusDto,
  SandboxWorkspaceDto,
  SandboxWorkspaceSpec,
} from './sandboxes.types'
import { ESandboxState } from './sandboxes.types'
import { SANDBOX_REGION, SandboxMissingError, VercelSandboxClient } from './vercel-sandbox.client'
import type { WorkspaceColumns } from './workspace-spec'
import { workspaceColumnsOf, workspaceSpecOf } from './workspace-spec'

const MINUTE_MS = 60_000

const nextSandboxId = (): string => `sbx_${randomUUID()}`
const nowIso = (): string => new Date().toISOString()
const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class SandboxesService {
  private readonly logger = new Logger(SandboxesService.name)
  private readonly attachLocks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly env: EnvService,
    private readonly github: GithubService,
  ) {}

  async attach(args: {
    userId: string
    threadId: string
    workspace?: SandboxWorkspaceSpec | undefined
  }): Promise<SandboxAttachmentDto> {
    const previous = this.attachLocks.get(args.threadId) ?? Promise.resolve()
    const run = previous.then(
      () => this.attachSerialized(args),
      () => this.attachSerialized(args),
    )
    this.attachLocks.set(args.threadId, run)
    try {
      return await run
    } finally {
      if (this.attachLocks.get(args.threadId) === run) this.attachLocks.delete(args.threadId)
    }
  }

  private async attachSerialized(args: {
    userId: string
    threadId: string
    workspace?: SandboxWorkspaceSpec | undefined
  }): Promise<SandboxAttachmentDto> {
    const thread = await ownedThread({ reader: db, userId: args.userId, threadId: args.threadId })
    const columns = workspaceColumnsOf(args.workspace)
    const minted = mintSessionToken()
    const claimed = await this.claim({ thread, tokenHash: minted.tokenHash, columns })
    if (claimed.tokenHash === minted.tokenHash) {
      return this.provision({ row: claimed, token: minted.token })
    }
    const resumed = await this.tryResume(claimed)
    if (resumed !== null) return resumed
    await db.cloudSandbox.delete({ where: { threadId: claimed.threadId } })
    const reclaimed = await this.claim({ thread, tokenHash: minted.tokenHash, columns })
    if (reclaimed.tokenHash !== minted.tokenHash) {
      throw new ConflictException('another attach is provisioning this sandbox — retry in a moment')
    }
    return this.provision({ row: reclaimed, token: minted.token })
  }

  /**
   * Answered to the sandbox rather than pushed into its environment: a patch outgrows what a
   * process environment will carry. The git credential is read per request and never stored on the
   * sandbox row.
   */
  async workspace(args: { threadId: string }): Promise<SandboxWorkspaceDto> {
    const row = await db.cloudSandbox.findUnique({ where: { threadId: args.threadId } })
    if (row === null) throw new NotFoundException('sandbox not found')
    const spec = workspaceSpecOf(row)
    if (spec.remoteUrl === null) return { ...spec, githubToken: null }
    const githubToken = await this.github.findToken({ userId: row.userId })
    return { ...spec, githubToken: githubToken ?? null }
  }

  async status(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    const observed = await this.vercel.inspect({ name: row.name })
    return {
      ...toSandboxDto(row),
      state: observed.state,
      ...(observed.url === undefined ? {} : { url: observed.url }),
    }
  }

  async stop(args: { userId: string; threadId: string }): Promise<SandboxStatusDto> {
    const row = await ownedSandbox(args)
    await this.park({ row })
    return { ...toSandboxDto(row), state: ESandboxState.Parked }
  }

  async verifySessionToken(args: { threadId: string; token: string }): Promise<CloudSandboxModel> {
    const row = await db.cloudSandbox.findUnique({ where: { threadId: args.threadId } })
    if (row === null || !tokenMatches({ token: args.token, tokenHash: row.tokenHash })) {
      throw new UnauthorizedException('a valid sandbox session token is required')
    }
    return row
  }

  async heartbeat(args: { threadId: string }): Promise<void> {
    const at = nowIso()
    await db.cloudSandbox.updateMany({
      where: { threadId: args.threadId },
      data: { lastActivityAt: at, updatedAt: at },
    })
  }

  async reap(): Promise<number> {
    const quietSince = new Date(Date.now() - this.ttlMs()).toISOString()
    const stale = await db.cloudSandbox.findMany({
      where: {
        state: { notIn: [ESandboxState.Parked] },
        lastActivityAt: { lt: quietSince },
      },
    })

    let parked = 0
    for (const row of stale) {
      try {
        await this.park({ row })
        parked += 1
      } catch (failure) {
        this.logger.warn(`could not park sandbox ${row.name}: ${String(failure)}`)
      }
    }
    return parked
  }

  async park(args: { row: CloudSandboxModel }): Promise<void> {
    await this.vercel.stop({ name: args.row.name })
    await db.cloudSandbox.update({
      where: { threadId: args.row.threadId },
      data: { state: ESandboxState.Parked, updatedAt: nowIso() },
    })
  }

  private ttlMs(): number {
    return this.env.get('SANDBOX_TTL_MINUTES') * MINUTE_MS
  }

  private claim(args: {
    thread: ThreadModel
    tokenHash: string
    columns: WorkspaceColumns
  }): Promise<CloudSandboxModel> {
    const at = nowIso()
    return db.cloudSandbox.upsert({
      where: { threadId: args.thread.id },
      create: {
        id: nextSandboxId(),
        threadId: args.thread.id,
        userId: args.thread.userId,
        sandboxId: '',
        name: sandboxNameFor({ threadId: args.thread.id }),
        region: SANDBOX_REGION,
        state: ESandboxState.Parked,
        lastActivityAt: at,
        tokenHash: args.tokenHash,
        ...args.columns,
        createdAt: at,
        updatedAt: at,
      },
      update: { lastActivityAt: at, updatedAt: at },
    })
  }

  private async provision(args: {
    row: CloudSandboxModel
    token: string
  }): Promise<SandboxAttachmentDto> {
    try {
      const placement = await this.vercel.getOrCreate({
        name: args.row.name,
        threadId: args.row.threadId,
        token: args.token,
      })
      const stamped = await this.stamp({ row: args.row, placement })
      return { ...toSandboxDto(stamped), url: placement.url, token: args.token }
    } catch (failure) {
      await db.cloudSandbox.delete({ where: { threadId: args.row.threadId } })
      if (failure instanceof HttpException) throw failure
      throw new BadGatewayException(messageOf(failure))
    }
  }

  private async tryResume(row: CloudSandboxModel): Promise<SandboxAttachmentDto | null> {
    try {
      const placement = await this.vercel.resume({ name: row.name })
      const stamped = await this.stamp({ row, placement })
      return { ...toSandboxDto(stamped), url: placement.url }
    } catch (failure) {
      if (failure instanceof SandboxMissingError) return null
      throw failure
    }
  }

  private stamp(args: {
    row: CloudSandboxModel
    placement: { sessionId: string; state: ESandboxState }
  }): Promise<CloudSandboxModel> {
    const at = nowIso()
    return db.cloudSandbox.update({
      where: { threadId: args.row.threadId },
      data: {
        sandboxId: args.placement.sessionId,
        state: args.placement.state,
        lastActivityAt: at,
        updatedAt: at,
      },
    })
  }
}
