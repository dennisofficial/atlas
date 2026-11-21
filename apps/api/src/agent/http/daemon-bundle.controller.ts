import { Controller, Get, Inject, Req, Res, VERSION_NEUTRAL } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'

import type { AgentHostEnv } from '../config/env'
import { AGENT_HOST_ENV } from '../host/tokens'
import { DAEMON_BUNDLE_ROUTE, DAEMON_VERSION_HEADER, daemonBundleAnswerOf } from './daemon-bundle'
import { headerOf, type HostReply, type HostRequest } from './host-request'

const versionOf = (request: HostRequest): string | undefined => {
  const value = new URL(request.url, 'http://host').searchParams.get('version')
  return value === null || value === '' ? undefined : value
}

@Controller({ version: VERSION_NEUTRAL })
@SkipThrottle()
export class DaemonBundleController {
  constructor(@Inject(AGENT_HOST_ENV) private readonly env: AgentHostEnv) {}

  @Get(DAEMON_BUNDLE_ROUTE)
  async handleBundle(@Req() request: HostRequest, @Res() response: HostReply): Promise<void> {
    const answer = await daemonBundleAnswerOf({
      secret: this.env.daemonSecret,
      path: this.env.daemonBundlePath,
      authorization: headerOf(request, 'authorization'),
      sandboxName: headerOf(request, 'x-atlas-sandbox'),
      version: versionOf(request),
    })
    if (answer.kind === 'forbidden') {
      response.status(403)
      response.send('forbidden')
      return
    }
    if (answer.kind === 'missing') {
      response.status(404)
      response.send('missing')
      return
    }
    if (answer.kind === 'mismatch') {
      response.status(409)
      response.setHeader(DAEMON_VERSION_HEADER, answer.version)
      response.send('mismatch')
      return
    }
    response.status(200)
    response.setHeader('content-type', 'application/javascript; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.send(answer.content)
  }
}
