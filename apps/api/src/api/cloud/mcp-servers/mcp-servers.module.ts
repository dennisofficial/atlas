import { Module } from '@nestjs/common'
import { McpServersRouter } from './mcp-servers.router'
import { McpServersService } from './mcp-servers.service'

@Module({
  providers: [McpServersRouter, McpServersService],
})
export class McpServersModule {}
