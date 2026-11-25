import { Module } from '@nestjs/common'
import { ProjectGroupsModule } from '../project-groups/project-groups.module'
import { ProjectsModule } from '../projects/projects.module'
import { McpServersRouter } from './mcp-servers.router'
import { McpServersService } from './mcp-servers.service'

@Module({
  imports: [ProjectsModule, ProjectGroupsModule],
  providers: [McpServersRouter, McpServersService],
})
export class McpServersModule {}
