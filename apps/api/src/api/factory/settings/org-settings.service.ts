import { BadRequestException, Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { FactoryConnectionsService } from '../connections/connections.service'
import { EFactoryConnectionProvider } from '../factory.types'
import { DEFAULT_FACTORY_MODEL_REF } from '../orchestrator/factory-credentials'
import {
  openModelCredential,
  openVercelCredential,
  sealBlob,
  type ModelCredentialBlob,
} from './org-credential-blobs'

const MODEL_REF_PATTERN = /^[^/\s]+\/\S+$/
const DEFAULT_PROVIDER = 'anthropic'

export type OrgSettingsDto = {
  model: {
    provider: string | null
    modelRef: string
    source: 'organization' | 'environment' | 'unconfigured'
    hasApiKey: boolean
  }
  vercel: { connected: boolean }
}

@Injectable()
export class OrgSettingsService {
  constructor(
    private readonly env: EnvService,
    private readonly connections: FactoryConnectionsService,
    private readonly cipher: SecretCipherService,
  ) {}

  async getSettings(args: { organizationId: string }): Promise<OrgSettingsDto> {
    return {
      model: await this.modelSettings(args),
      vercel: { connected: await this.vercelConnected(args) },
    }
  }

  async putModel(args: {
    organizationId: string
    apiKey: string
    modelRef: string
  }): Promise<void> {
    if (!MODEL_REF_PATTERN.test(args.modelRef)) {
      throw new BadRequestException('modelRef must look like provider/model')
    }
    const provider = args.modelRef.slice(0, args.modelRef.indexOf('/'))
    await this.connections.upsert({
      provider: EFactoryConnectionProvider.Model,
      externalAccountId: args.organizationId,
      organizationId: args.organizationId,
      status: 'active',
      sealedCredentials: sealBlob({
        cipher: this.cipher,
        blob: { provider, apiKey: args.apiKey, modelRef: args.modelRef },
      }),
    })
  }

  async putVercel(args: { organizationId: string; token: string }): Promise<void> {
    await this.connections.upsert({
      provider: EFactoryConnectionProvider.Vercel,
      externalAccountId: args.organizationId,
      organizationId: args.organizationId,
      status: 'active',
      sealedCredentials: sealBlob({ cipher: this.cipher, blob: { token: args.token } }),
    })
  }

  async readModelCredential(args: {
    organizationId: string
  }): Promise<ModelCredentialBlob | null> {
    const connection = await this.connections.resolve({
      provider: EFactoryConnectionProvider.Model,
      externalAccountId: args.organizationId,
    })
    if (connection?.sealedCredentials == null) return null
    return openModelCredential({ cipher: this.cipher, sealed: connection.sealedCredentials })
  }

  private async modelSettings(args: {
    organizationId: string
  }): Promise<OrgSettingsDto['model']> {
    const blob = await this.readModelCredential(args)
    if (blob !== null) {
      return {
        provider: blob.provider,
        modelRef: blob.modelRef,
        source: 'organization',
        hasApiKey: true,
      }
    }
    const apiKey = this.env.get('FACTORY_MODEL_API_KEY')
    const hasApiKey = apiKey !== undefined && apiKey.length > 0
    return {
      provider: this.env.get('FACTORY_MODEL_PROVIDER') ?? DEFAULT_PROVIDER,
      modelRef: this.env.get('FACTORY_MODEL_ID') ?? DEFAULT_FACTORY_MODEL_REF,
      source: hasApiKey ? 'environment' : 'unconfigured',
      hasApiKey,
    }
  }

  private async vercelConnected(args: { organizationId: string }): Promise<boolean> {
    const connection = await this.connections.resolve({
      provider: EFactoryConnectionProvider.Vercel,
      externalAccountId: args.organizationId,
    })
    if (connection?.sealedCredentials == null) return false
    return (
      openVercelCredential({ cipher: this.cipher, sealed: connection.sealedCredentials }) !== null
    )
  }
}
