import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ComposerDraftsRouter } from './composer-drafts.router'
import { ComposerDraftsService } from './composer-drafts.service'

@Module({
  imports: [SessionsModule],
  providers: [ComposerDraftsRouter, ComposerDraftsService],
})
export class ComposerDraftsModule {}
