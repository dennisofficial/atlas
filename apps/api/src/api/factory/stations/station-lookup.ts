import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { db } from '../../../db'
import { EFactoryAliasKind, type WorkItemDto } from '../factory.types'
import { WorkItemsService } from '../work-items.service'

export type StationRunRow = {
  id: string
  workItemId: string
  kind: string
  threadId: string
  status: string
}

/** The caller's sandbox thread must be the claimed orchestrator of a work item. */
export async function orchestratedItem(args: { threadId: string }): Promise<WorkItemDto> {
  const item = await db.factoryWorkItem.findFirst({
    where: { orchestratorThreadId: args.threadId },
  })
  if (item === null) {
    throw new ForbiddenException('this sandbox is not the orchestrator of any work item')
  }
  return item
}

export async function runningRunOf(args: {
  item: WorkItemDto
  runId: string
  notRunning: (run: StationRunRow) => Error
}): Promise<StationRunRow> {
  const run = await db.factoryStationRun.findUnique({ where: { id: args.runId } })
  if (run === null || run.workItemId !== args.item.id) {
    throw new NotFoundException(`unknown station run ${args.runId} on this work item`)
  }
  if (run.status !== 'running') throw args.notRunning(run)
  return run
}

export function repoCoordinatesOf(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split('/')
  if (owner === undefined || name === undefined || owner.length === 0 || name.length === 0) {
    throw new UnprocessableEntityException(`work item repo ${repo} is not owner/repo`)
  }
  return { owner, repo: name }
}

/**
 * Station events are recorded against the work item's ticket surface so the transcript reads as
 * one story; a work item without one (no intake alias) falls back to the repo itself, and callers
 * treat a null append as the loud failure it is.
 */
export async function ticketAliasOf(args: {
  workItems: WorkItemsService
  item: WorkItemDto
}): Promise<{ surface: string; externalId: string }> {
  const aliases = await args.workItems.listAliases({ workItemId: args.item.id })
  const ticket = aliases.find(
    (alias) => alias.kind === EFactoryAliasKind.Issue || alias.kind === EFactoryAliasKind.Ticket,
  )
  return ticket ?? { surface: args.item.sourceKind, externalId: args.item.repo }
}
