import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { ArtifactBlobStore } from './artifact-blob-store'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'
import { S3ArtifactBlobStore } from './s3-artifact-blob-store'

@Module({
  providers: [
    ArtifactsRouter,
    ArtifactsService,
    ArtifactLibraryService,
    ArtifactLifecycleService,
    {
      provide: ArtifactBlobStore,
      useFactory: (env: EnvService): ArtifactBlobStore => new S3ArtifactBlobStore({ env }),
      inject: [EnvService],
    },
  ],
})
export class ArtifactsModule {}
