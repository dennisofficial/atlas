import { Injectable, Logger } from '@nestjs/common'
import { db } from '../../../db'
import { VercelSandboxClient } from '../../platform/sandboxes/vercel-sandbox.client'
import { EFactoryAliasKind, EFactoryWorkItemStatus, type WorkItemDto } from '../factory.types'
import { WorkItemsService } from '../work-items.service'
import { driveNameFor, fallbackDriveNameFor, issueNumberOf } from './drive-names'

const IDLE_DRIVE_LIMIT_MS = 14 * 24 * 60 * 60 * 1000

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * Drive policy: one per work item, named after the ticket, created lazily (a work item that is
 * only ever triaged never pays for storage), released on merge/close and by the idle sweeper.
 * The name is persisted ahead of creation so a half-failed create retries to the same drive.
 */
@Injectable()
export class FactoryDrivesService {
  private readonly logger = new Logger(FactoryDrivesService.name)

  constructor(
    private readonly vercel: VercelSandboxClient,
    private readonly workItems: WorkItemsService,
  ) {}

  async ensure(args: { workItemId: string }): Promise<string> {
    const item = await this.workItems.find({ workItemId: args.workItemId })
    if (item.driveName !== null) {
      await this.vercel.ensureDrive({ name: item.driveName })
      return item.driveName
    }
    const name = await this.nameFor(item)
    await this.vercel.ensureDrive({ name })
    await this.workItems.attachDrive({ workItemId: item.id, driveName: name })
    return name
  }

  /** Returns false when the drive could not go (still attached); the sweeper retries it later. */
  async release(args: { workItemId: string }): Promise<boolean> {
    const item = await this.workItems.find({ workItemId: args.workItemId })
    if (item.driveName === null) return true
    try {
      await this.vercel.deleteDrive({ name: item.driveName })
    } catch (failure) {
      this.logger.warn(
        `could not delete drive ${item.driveName} for work item ${item.id}: ${messageOf(failure)}`,
      )
      return false
    }
    await this.workItems.releaseDrive({ workItemId: item.id })
    return true
  }

  /**
   * Two populations carry a drive past its welcome: items idle past the threshold, and terminal
   * items whose merge/close release failed under an attached mount — the merge bumps
   * lastActivityAt, so keying only on idle time would strand those for a fortnight.
   */
  async sweepIdle(): Promise<number> {
    const quietSince = new Date(Date.now() - IDLE_DRIVE_LIMIT_MS).toISOString()
    const stale = await db.factoryWorkItem.findMany({
      where: {
        driveName: { not: null },
        OR: [
          { lastActivityAt: { lt: quietSince } },
          { status: { in: [EFactoryWorkItemStatus.Merged, EFactoryWorkItemStatus.Closed] } },
        ],
      },
      select: { id: true },
    })
    let released = 0
    for (const item of stale) {
      if (await this.release({ workItemId: item.id })) released += 1
    }
    return released
  }

  private async nameFor(item: WorkItemDto): Promise<string> {
    const aliases = await this.workItems.listAliases({ workItemId: item.id })
    const ticket = aliases.find(
      (alias) => alias.kind === EFactoryAliasKind.Issue || alias.kind === EFactoryAliasKind.Ticket,
    )
    const number = ticket === null || ticket === undefined ? null : issueNumberOf(ticket.externalId)
    if (number !== null) return driveNameFor({ repo: item.repo, number })
    return fallbackDriveNameFor({ workItemId: item.id })
  }
}
