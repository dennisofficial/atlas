import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { GithubAppService } from '../reply/github-app.service'
import { WorkItemsService } from '../work-items.service'
import { repoCoordinatesOf } from './station-lookup'
import { EStationRunStatus, FACTORY_BRANCH_PREFIX, type StationGitToken } from './station.types'

const GIT_TOKEN_EXPIRY_SECONDS = 3600

/**
 * The git credential broker for running stations. The refusal binds the declared branch: the
 * minted installation token is repo-scoped (GitHub offers nothing narrower), so delivery-time
 * verification — factory branch, head SHA match — is the gate that actually holds.
 */
@Injectable()
export class StationTokensService {
  constructor(
    private readonly workItems: WorkItemsService,
    private readonly githubApp: GithubAppService,
  ) {}

  async mintGitToken(args: {
    stationThreadId: string
    branch: string
  }): Promise<StationGitToken> {
    const run = await db.factoryStationRun.findFirst({
      where: { threadId: args.stationThreadId, status: EStationRunStatus.Running },
    })
    if (run === null) {
      throw new ForbiddenException('this sandbox is not a running factory station')
    }
    if (args.branch === 'main' || args.branch === 'master') {
      throw new BadRequestException(`pushing to ${args.branch} is refused — stations never touch it`)
    }
    if (!args.branch.startsWith(FACTORY_BRANCH_PREFIX)) {
      throw new BadRequestException(
        `factory stations push only ${FACTORY_BRANCH_PREFIX}* branches; ${args.branch} is refused`,
      )
    }
    const item = await this.workItems.find({ workItemId: run.workItemId })
    const { owner, repo } = repoCoordinatesOf(item.repo)
    const token = await this.githubApp.installationToken({ owner, repo })
    return { token, expiresInSeconds: GIT_TOKEN_EXPIRY_SECONDS }
  }
}
