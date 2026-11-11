import { Module } from '@nestjs/common'
import { SessionsModule } from '../../platform/sessions/sessions.module'
import { ArtifactBlobStore } from './artifact-blob-store'
import { ArtifactLifecycleService } from './artifact-lifecycle.service'
import { ArtifactLibraryService } from './artifact-library.service'
import { ArtifactRetention } from './artifact-retention'
import { ArtifactBuild } from './artifact-build'
import { ArtifactSandbox } from './artifact-sandbox'
import { ArtifactsRouter } from './artifacts.router'
import { ArtifactsService } from './artifacts.service'
import { VercelArtifactBlobStore } from './vercel-artifact-blob-store'
import { VercelArtifactSandbox } from './vercel-artifact-sandbox'
import { SandboxCredentialsModule } from '../sandbox-credentials/sandbox-credentials.module'

@Module({
  imports: [SessionsModule, SandboxCredentialsModule],
  providers: [
    ArtifactsRouter,
    ArtifactsService,
    ArtifactLibraryService,
    ArtifactLifecycleService,
    ArtifactRetention,
    ArtifactBuild,
    { provide: ArtifactBlobStore, useClass: VercelArtifactBlobStore },
    { provide: ArtifactSandbox, useClass: VercelArtifactSandbox },
  ],
})
export class ArtifactsModule {}
