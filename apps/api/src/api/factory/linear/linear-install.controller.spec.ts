import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import type { Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvService } from '../../../_core/config/env/env.service'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { LinearInstallController } from './linear-install.controller'
import type { LinearInstallService } from './linear-install.service'

const ENV = {
  BETTER_AUTH_URL: 'https://api.byatlas.io',
  WEB_ORIGIN: 'https://byatlas.io',
}

function requestWith(auth: AuthenticatedRequest['auth']): AuthenticatedRequest {
  return { auth } as unknown as AuthenticatedRequest
}

function fakeResponse(): { redirect: ReturnType<typeof vi.fn> } {
  return { redirect: vi.fn() }
}

describe('LinearInstallController', () => {
  let install: { beginInstall: ReturnType<typeof vi.fn>; completeInstall: ReturnType<typeof vi.fn> }
  let controller: LinearInstallController

  beforeEach(() => {
    install = {
      beginInstall: vi.fn(() => 'https://linear.app/oauth/authorize?state=abc'),
      completeInstall: vi.fn(async () => undefined),
    }
    controller = new LinearInstallController(
      new EnvService(ENV),
      install as unknown as LinearInstallService,
    )
  })

  it('install redirects to the authorize url for a session with an active organization', () => {
    const response = fakeResponse()

    controller.handleInstall(
      requestWith({
        userId: 'u-1',
        sessionId: 's-1',
        email: 'd@comp.ai',
        activeOrganizationId: 'org_compai',
      }),
      response as unknown as Response,
    )

    expect(install.beginInstall).toHaveBeenCalledWith({
      organizationId: 'org_compai',
      apiOrigin: 'https://api.byatlas.io',
    })
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://linear.app/oauth/authorize?state=abc',
    )
  })

  it('install answers 400 when the session has no active organization', () => {
    const response = fakeResponse()

    expect(() =>
      controller.handleInstall(
        requestWith({
          userId: 'u-1',
          sessionId: 's-1',
          email: 'd@comp.ai',
          activeOrganizationId: null,
        }),
        response as unknown as Response,
      ),
    ).toThrow(BadRequestException)
    expect(install.beginInstall).not.toHaveBeenCalled()
  })

  it('install answers 401 without a verified session', () => {
    expect(() =>
      controller.handleInstall(requestWith(undefined), fakeResponse() as unknown as Response),
    ).toThrow(UnauthorizedException)
  })

  it('install propagates a 503 when the oauth app is not configured', () => {
    install.beginInstall.mockImplementation(() => {
      throw new ServiceUnavailableException('the linear oauth app is not configured yet')
    })

    expect(() =>
      controller.handleInstall(
        requestWith({
          userId: 'u-1',
          sessionId: 's-1',
          email: 'd@comp.ai',
          activeOrganizationId: 'org_compai',
        }),
        fakeResponse() as unknown as Response,
      ),
    ).toThrow(ServiceUnavailableException)
  })

  it('callback redirects to the web app with a success param', async () => {
    const response = fakeResponse()

    await controller.handleCallback('code-1', 'state-1', undefined, response as unknown as Response)

    expect(install.completeInstall).toHaveBeenCalledWith({
      code: 'code-1',
      state: 'state-1',
      apiOrigin: 'https://api.byatlas.io',
    })
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://byatlas.io/factory/linear?installed=success',
    )
  })

  it('callback redirects with an error param when linear sends an error', async () => {
    const response = fakeResponse()

    await controller.handleCallback(undefined, undefined, 'access_denied', response as unknown as Response)

    expect(install.completeInstall).not.toHaveBeenCalled()
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://byatlas.io/factory/linear?installed=error',
    )
  })

  it('callback redirects with an error param when the exchange fails', async () => {
    install.completeInstall.mockRejectedValue(new Error('linear token request failed with status 400'))
    const response = fakeResponse()

    await controller.handleCallback('code-1', 'state-1', undefined, response as unknown as Response)

    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://byatlas.io/factory/linear?installed=error',
    )
  })

  it('callback answers 400 for an unknown state instead of redirecting', async () => {
    install.completeInstall.mockRejectedValue(new BadRequestException('unknown or expired linear install state'))

    await expect(
      controller.handleCallback('code-1', 'state-1', undefined, fakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('callback propagates a 503 when the oauth app is not configured', async () => {
    install.completeInstall.mockRejectedValue(
      new ServiceUnavailableException('the linear oauth app is not configured yet'),
    )

    await expect(
      controller.handleCallback('code-1', 'state-1', undefined, fakeResponse() as unknown as Response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
