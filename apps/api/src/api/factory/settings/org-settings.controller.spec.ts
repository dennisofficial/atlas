import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../../../_core/types/auth.types'
import { OrgSettingsController } from './org-settings.controller'
import type { OrgSettingsService } from './org-settings.service'

function requestWith(auth: AuthenticatedRequest['auth']): AuthenticatedRequest {
  return { auth } as unknown as AuthenticatedRequest
}

const SESSION = {
  userId: 'u-1',
  sessionId: 's-1',
  email: 'd@comp.ai',
  activeOrganizationId: 'org_compai',
}

const SETTINGS_DTO = {
  model: {
    provider: 'anthropic',
    modelRef: 'anthropic/claude-opus',
    source: 'organization' as const,
    hasApiKey: true,
  },
  vercel: { connected: true },
}

describe('OrgSettingsController', () => {
  let settings: {
    getSettings: ReturnType<typeof vi.fn>
    putModel: ReturnType<typeof vi.fn>
    putVercel: ReturnType<typeof vi.fn>
  }
  let controller: OrgSettingsController

  beforeEach(() => {
    settings = {
      getSettings: vi.fn(async () => SETTINGS_DTO),
      putModel: vi.fn(async () => undefined),
      putVercel: vi.fn(async () => undefined),
    }
    controller = new OrgSettingsController(settings as unknown as OrgSettingsService)
  })

  it('get returns the settings for the active organization', async () => {
    const dto = await controller.handleGet(requestWith(SESSION))

    expect(settings.getSettings).toHaveBeenCalledWith({ organizationId: 'org_compai' })
    expect(dto).toEqual(SETTINGS_DTO)
  })

  it('get answers 401 without a verified session', async () => {
    await expect(controller.handleGet(requestWith(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
    expect(settings.getSettings).not.toHaveBeenCalled()
  })

  it('get answers 400 when the session has no active organization', async () => {
    await expect(
      controller.handleGet(requestWith({ ...SESSION, activeOrganizationId: null })),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(settings.getSettings).not.toHaveBeenCalled()
  })

  it('putModel stores the credential and answers ok', async () => {
    const body = { apiKey: 'sk-key', modelRef: 'anthropic/claude-opus' }

    await expect(controller.handlePutModel(requestWith(SESSION), body)).resolves.toEqual({
      ok: true,
    })
    expect(settings.putModel).toHaveBeenCalledWith({
      organizationId: 'org_compai',
      apiKey: 'sk-key',
      modelRef: 'anthropic/claude-opus',
    })
  })

  it('putModel answers 401 without a verified session', async () => {
    await expect(
      controller.handlePutModel(requestWith(undefined), {
        apiKey: 'sk-key',
        modelRef: 'anthropic/claude-opus',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(settings.putModel).not.toHaveBeenCalled()
  })

  it('putModel answers 400 when the session has no active organization', async () => {
    await expect(
      controller.handlePutModel(requestWith({ ...SESSION, activeOrganizationId: null }), {
        apiKey: 'sk-key',
        modelRef: 'anthropic/claude-opus',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(settings.putModel).not.toHaveBeenCalled()
  })

  it('putModel propagates a 400 for a malformed modelRef', async () => {
    settings.putModel.mockRejectedValue(
      new BadRequestException('modelRef must look like provider/model'),
    )

    await expect(
      controller.handlePutModel(requestWith(SESSION), { apiKey: 'sk-key', modelRef: 'bad' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('putVercel stores the token and answers ok', async () => {
    await expect(
      controller.handlePutVercel(requestWith(SESSION), { token: 'v-token' }),
    ).resolves.toEqual({ ok: true })
    expect(settings.putVercel).toHaveBeenCalledWith({
      organizationId: 'org_compai',
      token: 'v-token',
    })
  })

  it('putVercel answers 401 without a verified session', async () => {
    await expect(
      controller.handlePutVercel(requestWith(undefined), { token: 'v-token' }),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    expect(settings.putVercel).not.toHaveBeenCalled()
  })

  it('putVercel answers 400 when the session has no active organization', async () => {
    await expect(
      controller.handlePutVercel(requestWith({ ...SESSION, activeOrganizationId: null }), {
        token: 'v-token',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(settings.putVercel).not.toHaveBeenCalled()
  })
})
