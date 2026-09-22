import { Module } from '@nestjs/common'
import { McpServersController } from './mcp-servers.controller'
import { McpServersService } from './mcp-servers.service'

@Module({
  controllers: [McpServersController],
  providers: [McpServersService],
})
export class McpServersModule {}
