import { Module } from '@nestjs/common'
import { ComposerDraftsRouter } from './composer-drafts.router'
import { ComposerDraftsService } from './composer-drafts.service'

@Module({
  providers: [ComposerDraftsRouter, ComposerDraftsService],
})
export class ComposerDraftsModule {}
