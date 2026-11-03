import type { NestExpressApplication } from '@nestjs/platform-express'
import { vi } from 'bun:test'
import {
  createMiddlewareApp,
  UNTHROTTLED_RATE_LIMIT,
} from '../../../_module/trpc/trpc-middleware.fixture'
import { V2AgentHostMiddleware } from './v2-agent-host.middleware'
import { V2AgentHostRouter } from './v2-agent-host.router'
import { V2AgentHostService } from './v2-agent-host.service'

export const agentHost = {
  config: vi.fn(),
  modelAccessToken: vi.fn(),
  githubToken: vi.fn(),
}

export const createV2AgentHostApp = (args?: {
  token?: string | undefined
}): Promise<NestExpressApplication> =>
  createMiddlewareApp({
    rateLimit: UNTHROTTLED_RATE_LIMIT,
    envValues: { V2_AGENT_HOST_TOKEN: args?.token },
    providers: [
      V2AgentHostRouter,
      V2AgentHostMiddleware,
      { provide: V2AgentHostService, useValue: agentHost },
    ],
  })
