import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { FactoryConnectionsService } from '../connections/connections.service'
import {
  DEFAULT_ORGANIZATION_ID,
  EFactoryConnectionProvider,
  EFactorySurface,
  type WorkItemDto,
} from '../factory.types'
import {
  createComment,
  getIssue,
  markDuplicate,
  setState,
  type LinearIssue,
} from '../linear/linear-client'
import { LinearTokensService } from '../linear/linear-tokens.service'
import { orchestratedItem } from '../stations/station-lookup'
import { WorkItemsService } from '../work-items.service'

@Injectable()
export class FactoryToolsService {
  constructor(
    private readonly workItems: WorkItemsService,
    private readonly connections: FactoryConnectionsService,
    private readonly linearTokens: LinearTokensService,
  ) {}

  async getLinearIssue(args: { threadId: string; issueId: string }): Promise<LinearIssue> {
    const item = await orchestratedItem({ threadId: args.threadId })
    const token = await this.linearToken({ item })
    return getIssue({ token, issueId: args.issueId })
  }

  async commentLinearIssue(args: {
    threadId: string
    issueId: string
    body: string
  }): Promise<{ url: string }> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireLinearAlias({ item, issueId: args.issueId })
    const token = await this.linearToken({ item })
    return createComment({ token, issueId: args.issueId, body: args.body })
  }

  async setLinearState(args: {
    threadId: string
    issueId: string
    stateName: string
  }): Promise<{ stateName: string }> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireLinearAlias({ item, issueId: args.issueId })
    const token = await this.linearToken({ item })
    return setState({ token, issueId: args.issueId, stateName: args.stateName })
  }

  async markLinearDuplicate(args: {
    threadId: string
    issueId: string
    duplicateOfId: string
  }): Promise<{ url: string }> {
    const item = await orchestratedItem({ threadId: args.threadId })
    await this.requireLinearAlias({ item, issueId: args.issueId })
    const token = await this.linearToken({ item })
    return markDuplicate({ token, issueId: args.issueId, duplicateOfId: args.duplicateOfId })
  }

  private async requireLinearAlias(args: { item: WorkItemDto; issueId: string }): Promise<void> {
    const aliases = await this.workItems.listAliases({ workItemId: args.item.id })
    const linked = aliases.some(
      (alias) => alias.surface === EFactorySurface.Linear && alias.externalId === args.issueId,
    )
    if (!linked) {
      throw new ForbiddenException(
        `linear issue ${args.issueId} is not a surface of this work item`,
      )
    }
  }

  private async linearToken(args: { item: WorkItemDto }): Promise<string> {
    const organizationId = args.item.organizationId ?? DEFAULT_ORGANIZATION_ID
    const connections = await this.connections.listForOrganization({ organizationId })
    const linear = connections.find((one) => one.provider === EFactoryConnectionProvider.Linear)
    if (linear === undefined) {
      throw new ServiceUnavailableException('this organization has no linear connection')
    }
    return this.linearTokens.getToken({ workspaceId: linear.externalAccountId })
  }
}
