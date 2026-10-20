import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { BundleBlobStore } from './blob-store'
import { PublishedBundlesController } from './published-bundles.controller'
import { PublishedBundlesService } from './published-bundles.service'
import { VercelBundleBlobStore } from './vercel-bundle-blob-store'

@Module({
  imports: [SessionsModule],
  controllers: [PublishedBundlesController],
  providers: [PublishedBundlesService, { provide: BundleBlobStore, useClass: VercelBundleBlobStore }],
})
export class PublishedBundlesModule {}
