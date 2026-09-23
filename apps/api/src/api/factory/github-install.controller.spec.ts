import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../_core/config/env/env.service'
import type { AuthenticatedRequest } from '../../_core/types/auth.types'
import { GithubInstallController } from './github-install.controller'
import type { GithubInstallService } from './github-install.service'

const ENV = {
  WEB_ORIGIN: 'https://byatlas.io',
}

const INSTALL_URL = 'https://github.com/apps/atlas-factory/installations/new?state=abc'

function requestWith(auth: AuthenticatedRequest['auth']): AuthenticatedRequest {
  return { auth } as unknown as AuthenticatedRequest
}

function fakeResponse(): { redirect: ReturnType<typeof vi.fn> } {
  return { redirect: vi.fn() }
}

describe('GithubInstallController', () => {
  let install: { beginInstall: ReturnType<typeof vi.fn>; completeInstall: ReturnType<typeof vi.fn> }
  let controller: GithubInstallController

  beforeEach(() => {
    install = {
      beginInstall: vi.fn(async () => INSTALL_URL),
      completeInstall: vi.fn(async () => undefined),
    }
    controller = new GithubInstallController(
      new EnvService(ENV),
      install as unknown as GithubInstallService,
    )
  })

  it('install redirects to the github install url for a session with an active organization', async () => {
    const response = fakeResponse()

    await controller.handleInstall(
      requestWith({
        userId: 'u-1',
        sessionId: 's-1',
        email: 'd@comp.ai',
        activeOrganizationId: 'org_compai',
      }),
      response as unknown as Response,
    )

    expect(install.beginInstall).toHaveBeenCalledWith({ organizationId: 'org_compai' })
    expect(response.redirect).toHaveBeenCalledWith(302, INSTALL_URL)
  })

  it('install answers 400 when the session has no active organization', async () => {
    const response = fakeResponse()

    await expect(
      controller.handleInstall(
        requestWith({
          userId: 'u-1',
          sessionId: 's-1',
          email: 'd@comp.ai',
          activeOrganizationId: null,
        }),
        response as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(install.beginInstall).not.toHaveBeenCalled()
  })

  it('install answers 401 without a verified session', async () => {
    await expect(
      controller.handleInstall(requestWith(undefined), fakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('callback redirects to the web app with an installed param', async () => {
    const response = fakeResponse()

    await controller.handleCallback('12345678', 'state-1', 'install', response as unknown as Response)

    expect(install.completeInstall).toHaveBeenCalledWith({
      installationId: '12345678',
      state: 'state-1',
    })
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://byatlas.io/factory?github=installed')
  })

  it('callback redirects with an error param when installation_id or state is missing', async () => {
    const response = fakeResponse()

    await controller.handleCallback(undefined, undefined, 'install', response as unknown as Response)

    expect(install.completeInstall).not.toHaveBeenCalled()
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://byatlas.io/factory?github=error')
  })

  it('callback redirects with an error param when completion fails unexpectedly', async () => {
    install.completeInstall.mockRejectedValue(new Error('connection store unavailable'))
    const response = fakeResponse()

    await controller.handleCallback('12345678', 'state-1', 'install', response as unknown as Response)

    expect(response.redirect).toHaveBeenCalledWith(302, 'https://byatlas.io/factory?github=error')
  })

  it('callback answers 400 for an unknown state instead of redirecting', async () => {
    install.completeInstall.mockRejectedValue(
      new BadRequestException('unknown or expired github install state'),
    )

    await expect(
      controller.handleCallback('12345678', 'state-1', 'install', fakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
