import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { SandboxPrincipal } from '../../platform/sandboxes/rows'
import {
  OrchestratorSandboxGuard,
  type OrchestratorSandboxRequest,
} from '../reply/orchestrator-sandbox.guard'
import {
  GithubCloseIssueDto,
  GithubLabelDto,
  LinearCommentDto,
  LinearMarkDuplicateDto,
  LinearSetStateDto,
} from './tools.dto'
import { FactoryGithubToolsService } from './tools-github.service'
import { FactoryToolsService } from './tools.service'

const callerOf = (request: OrchestratorSandboxRequest): SandboxPrincipal => {
  const sandbox = request.orchestratorSandbox
  if (sandbox === undefined) throw new UnauthorizedException('a sandbox session token is required')
  return sandbox
}

@Controller({ path: 'factory/tools', version: '1' })
@SkipThrottle()
@UseGuards(OrchestratorSandboxGuard)
export class FactoryToolsController {
  constructor(
    private readonly tools: FactoryToolsService,
    private readonly github: FactoryGithubToolsService,
  ) {}

  @Get('github/issues/:owner/:repo/:number')
  handleGetGithubIssue(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<unknown> {
    return this.github.getIssue({ threadId: callerOf(request).threadId, owner, repo, number })
  }

  @Get('github/issues/:owner/:repo/:number/comments')
  handleGetGithubIssueComments(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<unknown> {
    return this.github.getIssueComments({
      threadId: callerOf(request).threadId,
      owner,
      repo,
      number,
    })
  }

  @Get('github/pulls/:owner/:repo/:number')
  handleGetGithubPullRequest(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<unknown> {
    return this.github.getPullRequest({ threadId: callerOf(request).threadId, owner, repo, number })
  }

  @Get('github/pulls/:owner/:repo/:number/diff')
  handleGetGithubPullRequestDiff(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
  ): Promise<{ diff: string }> {
    return this.github.getPullRequestDiff({
      threadId: callerOf(request).threadId,
      owner,
      repo,
      number,
    })
  }

  @Post('github/issues/:owner/:repo/:number/close')
  handleGithubCloseIssue(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: GithubCloseIssueDto,
  ): Promise<{ url: string }> {
    return this.github.closeIssue({
      threadId: callerOf(request).threadId,
      owner,
      repo,
      number,
      body: body.body,
    })
  }

  @Post('github/issues/:owner/:repo/:number/labels')
  handleGithubAddLabel(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: GithubLabelDto,
  ): Promise<void> {
    return this.github.addLabel({
      threadId: callerOf(request).threadId,
      owner,
      repo,
      number,
      label: body.label,
    })
  }

  @Delete('github/issues/:owner/:repo/:number/labels/:label')
  handleGithubRemoveLabel(
    @Req() request: OrchestratorSandboxRequest,
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('label') label: string,
  ): Promise<void> {
    return this.github.removeLabel({
      threadId: callerOf(request).threadId,
      owner,
      repo,
      number,
      label,
    })
  }

  @Get('linear/issues/:id')
  handleGetLinearIssue(
    @Req() request: OrchestratorSandboxRequest,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.tools.getLinearIssue({ threadId: callerOf(request).threadId, issueId: id })
  }

  @Post('linear/issues/:id/comments')
  handleLinearComment(
    @Req() request: OrchestratorSandboxRequest,
    @Param('id') id: string,
    @Body() body: LinearCommentDto,
  ): Promise<{ url: string }> {
    return this.tools.commentLinearIssue({
      threadId: callerOf(request).threadId,
      issueId: id,
      body: body.body,
    })
  }

  @Post('linear/issues/:id/state')
  handleLinearSetState(
    @Req() request: OrchestratorSandboxRequest,
    @Param('id') id: string,
    @Body() body: LinearSetStateDto,
  ): Promise<{ stateName: string }> {
    return this.tools.setLinearState({
      threadId: callerOf(request).threadId,
      issueId: id,
      stateName: body.stateName,
    })
  }

  @Post('linear/issues/:id/duplicate')
  handleLinearMarkDuplicate(
    @Req() request: OrchestratorSandboxRequest,
    @Param('id') id: string,
    @Body() body: LinearMarkDuplicateDto,
  ): Promise<{ url: string }> {
    return this.tools.markLinearDuplicate({
      threadId: callerOf(request).threadId,
      issueId: id,
      duplicateOfId: body.duplicateOfId,
    })
  }
}
