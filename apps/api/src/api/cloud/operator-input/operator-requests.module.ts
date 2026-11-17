import { Module } from '@nestjs/common'
import { OperatorRequestsRouter } from './operator-requests.router'

@Module({ providers: [OperatorRequestsRouter] })
export class OperatorRequestsModule {}
