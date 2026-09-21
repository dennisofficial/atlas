import { Body, Controller, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { CloudSandboxModel } from '../../../db'
import {
  OrchestratorSandboxGuard,
  type OrchestratorSandboxRequest,
} from '../reply/orchestrator-sandbox.guard'
import {
  MintGitTokenDto,
  SpawnStationDto,
  SteerStationDto,
  SubmitStationResultDto,
} from './stations.dto'
import { StationsService } from './stations.service'
import type { StationGitToken, StationResultAccepted, StationSpawnResult } from './station.types'

const callerOf = (request: OrchestratorSandboxRequest): CloudSandboxModel => {
  const sandbox = request.orchestratorSandbox
  if (sandbox === undefined) throw new UnauthorizedException('a sandbox session token is required')
  return sandbox
}

@Controller({ path: 'factory', version: '1' })
@SkipThrottle()
@UseGuards(OrchestratorSandboxGuard)
export class FactoryStationsController {
  constructor(private readonly stations: StationsService) {}

  @Post('stations')
  handleSpawn(
    @Req() request: OrchestratorSandboxRequest,
    @Body() body: SpawnStationDto,
  ): Promise<StationSpawnResult> {
    return this.stations.spawn({
      orchestratorThreadId: callerOf(request).threadId,
      kind: body.kind,
      message: body.message,
    })
  }

  @Post('stations/:runId/steer')
  handleSteer(
    @Req() request: OrchestratorSandboxRequest,
    @Param('runId') runId: string,
    @Body() body: SteerStationDto,
  ): Promise<{ steered: true }> {
    return this.stations.steer({
      orchestratorThreadId: callerOf(request).threadId,
      runId,
      message: body.message,
    })
  }

  @Post('stations/:runId/stop')
  handleStop(
    @Req() request: OrchestratorSandboxRequest,
    @Param('runId') runId: string,
  ): Promise<{ stopped: true }> {
    return this.stations.stop({ orchestratorThreadId: callerOf(request).threadId, runId })
  }

  @Post('stations/:runId/result')
  handleResult(
    @Req() request: OrchestratorSandboxRequest,
    @Param('runId') runId: string,
    @Body() body: SubmitStationResultDto,
  ): Promise<StationResultAccepted> {
    return this.stations.submitResult({
      stationThreadId: callerOf(request).threadId,
      runId,
      result: body.result,
    })
  }

  @Post('git-token')
  handleGitToken(
    @Req() request: OrchestratorSandboxRequest,
    @Body() body: MintGitTokenDto,
  ): Promise<StationGitToken> {
    return this.stations.mintGitToken({
      stationThreadId: callerOf(request).threadId,
      branch: body.branch,
    })
  }
}
