import { Body, Controller, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'
import {
  OrchestratorSandboxGuard,
  type OrchestratorSandboxRequest,
} from '../reply/orchestrator-sandbox.guard'
import type { DeliveryResult } from '../stations/station.types'
import { DeliveriesService } from './deliveries.service'

const TITLE_MAX_LENGTH = 250
const BODY_MAX_LENGTH = 60_000

export class CreateDeliveryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TITLE_MAX_LENGTH)
  title!: string

  @IsString()
  @MaxLength(BODY_MAX_LENGTH)
  body!: string
}

@Controller({ path: 'factory/deliveries', version: '1' })
@SkipThrottle()
@UseGuards(OrchestratorSandboxGuard)
export class FactoryDeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Post()
  handleDeliver(
    @Req() request: OrchestratorSandboxRequest,
    @Body() body: CreateDeliveryDto,
  ): Promise<DeliveryResult> {
    const sandbox = request.orchestratorSandbox
    if (sandbox === undefined) throw new UnauthorizedException('a sandbox session token is required')
    return this.deliveries.deliver({
      orchestratorThreadId: sandbox.threadId,
      title: body.title,
      body: body.body,
    })
  }
}
