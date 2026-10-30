import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ComposerUploadBlobStore } from './composer-upload-blob-store'
import { ComposerUploadsRouter } from './composer-uploads.router'
import { ComposerUploadsService } from './composer-uploads.service'
import { VercelComposerUploadBlobStore } from './vercel-composer-upload-blob-store'

@Module({
  imports: [SessionsModule],
  providers: [
    ComposerUploadsRouter,
    ComposerUploadsService,
    {
      provide: ComposerUploadBlobStore,
      useClass: VercelComposerUploadBlobStore,
    },
  ],
})
export class ComposerUploadsModule {}
