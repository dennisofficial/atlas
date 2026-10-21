import { Module } from '@nestjs/common'
import { WorkspaceAccessService } from './workspace-access.service'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'
import { WorkspacesController } from './workspaces.controller'

@Module({
  controllers: [WorkspacesController],
  providers: [
    WorkspaceAccessService,
    WorkspaceResourcesService,
    WorkspaceSettingsService,
    WorkspaceVercelService,
  ],
  exports: [WorkspaceAccessService, WorkspaceVercelService],
})
export class WorkspacesModule {}
