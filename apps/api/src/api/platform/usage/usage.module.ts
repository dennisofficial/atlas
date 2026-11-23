import { Module } from '@nestjs/common'

import { UsageRouter } from './usage.router'

@Module({ providers: [UsageRouter] })
export class UsageModule {}
