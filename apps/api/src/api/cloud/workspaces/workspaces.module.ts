import { Module } from '@nestjs/common'
import { WorkspaceAccessService } from './workspace-access.service'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'
import { WorkspacesRouter } from './workspaces.router'

@Module({
  providers: [
    WorkspaceAccessService,
    WorkspaceResourcesService,
    WorkspaceSettingsService,
    WorkspaceVercelService,
    WorkspacesRouter,
  ],
  exports: [WorkspaceAccessService, WorkspaceVercelService],
})
export class WorkspacesModule {}
