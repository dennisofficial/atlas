import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { AgentHostMiddleware } from './agent-host.middleware'
import { AgentHostRouter } from './agent-host.router'
import { AgentHostService } from './agent-host.service'

export const agentHost = {
  modelAccessToken: vi.fn(),
  githubToken: vi.fn(),
}

export const createAgentHostApp = (args?: {
  token?: string | undefined
}): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    envValues: { AGENT_HOST_TOKEN: args?.token },
    providers: [
      AgentHostRouter,
      AgentHostMiddleware,
      { provide: AgentHostService, useValue: agentHost },
    ],
  })
