import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ArtifactBlobStore } from './artifact-blob-store'
import { artifactBlobStoreOf } from './artifact-blob-store.provider'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactBuild } from './artifact-build'
import { ArtifactSandbox } from './artifact-sandbox'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'
import { VercelArtifactSandbox } from './vercel-artifact-sandbox'
import { SandboxCredentialsModule } from '../sandbox-credentials/sandbox-credentials.module'

@Module({
  imports: [SessionsModule, SandboxCredentialsModule],
  providers: [
    ArtifactsRouter,
    ArtifactsService,
    ArtifactLibraryService,
    ArtifactLifecycleService,
    ArtifactBuild,
    {
      provide: ArtifactBlobStore,
      useFactory: (env: EnvService): ArtifactBlobStore => artifactBlobStoreOf(env),
      inject: [EnvService],
    },
    { provide: ArtifactSandbox, useClass: VercelArtifactSandbox },
  ],
})
export class ArtifactsModule {}
