import 'reflect-metadata'
import { describe, expect, it } from 'bun:test'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ClaimSandboxDto } from './sandboxes.dto'

const claimErrors = async (body: Record<string, unknown>) =>
  validate(plainToInstance(ClaimSandboxDto, body), { whitelist: true, forbidNonWhitelisted: true })

describe('ClaimSandboxDto', () => {
  it('accepts the driveName that released TUIs still send on a claim', async () => {
    const errors = await claimErrors({
      threadId: 'brn_1',
      gitToken: 'ghp_x',
      contextPending: true,
      driveName: 'atlas-drive-brn_1',
    })
    expect(errors).toEqual([])
  })
})
