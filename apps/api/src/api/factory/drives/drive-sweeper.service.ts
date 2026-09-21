import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { FactoryDrivesService } from './drives.service'

@Injectable()
export class FactoryDriveSweeperService {
  constructor(private readonly drives: FactoryDrivesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  handleSweep(): Promise<number> {
    return this.drives.sweepIdle()
  }
}
