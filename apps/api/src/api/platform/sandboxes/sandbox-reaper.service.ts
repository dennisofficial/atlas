import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { SandboxesService } from './sandboxes.service'

@Injectable()
export class SandboxReaperService {
  constructor(private readonly sandboxes: SandboxesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  handleSweep(): Promise<number> {
    return this.sandboxes.reap()
  }
}
