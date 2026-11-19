import { Module } from '@nestjs/common'
import { ControlPlaneModule } from '../../platform/control/control-plane.module'
import { Agent37WebhookController } from './agent37-webhook.controller'
import { Agent37WebhookService } from './agent37-webhook.service'

@Module({
  imports: [ControlPlaneModule],
  controllers: [Agent37WebhookController],
  providers: [Agent37WebhookService],
})
export class Agent37WebhookModule {}
