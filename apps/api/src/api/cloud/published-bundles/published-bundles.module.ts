import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { BundleBlobStore } from './blob-store'
import { PublishedBundlesRouter } from './published-bundles.router'
import { PublishedBundlesService } from './published-bundles.service'
import { VercelBundleBlobStore } from './vercel-bundle-blob-store'

@Module({
  imports: [SessionsModule],
  providers: [
    PublishedBundlesRouter,
    PublishedBundlesService,
    { provide: BundleBlobStore, useClass: VercelBundleBlobStore },
  ],
})
export class PublishedBundlesModule {}
