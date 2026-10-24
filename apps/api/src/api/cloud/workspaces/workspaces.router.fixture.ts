import type { INestApplication } from '@nestjs/common'
import { buildSessionTrpcApp } from '../session-trpc-test-app'
import { WorkspaceAccessService } from './workspace-access.service'
import { WorkspaceResourcesService } from './workspace-resources.service'
import { WorkspaceSettingsService } from './workspace-settings.service'
import { WorkspaceVercelService } from './workspace-vercel.service'
import { WorkspacesRouter } from './workspaces.router'

export const ORG = 'org-1'

export const buildWorkspacesApp = (): Promise<INestApplication> =>
  buildSessionTrpcApp({
    providers: [
      WorkspaceAccessService,
      WorkspaceResourcesService,
      WorkspaceSettingsService,
      WorkspaceVercelService,
      WorkspacesRouter,
    ],
  })
