import { SchemaTool, TAKES_NO_PATHS, type ToolOutcome, type ToolRun } from '@dltech/atlas-core'
import type { z, ZodType } from 'zod'

import { CloudError } from '../../cloud/cloud-transport'

import type { FactoryClient } from './client'

const present = (body: unknown): string => {
  if (typeof body === 'string') return body
  return JSON.stringify(body, null, 2)
}

export abstract class FactoryTool<TSchema extends ZodType> extends SchemaTool<TSchema> {
  override readonly pathFields = TAKES_NO_PATHS

  constructor(protected readonly client: FactoryClient) {
    super()
  }

  protected abstract call(args: { input: z.output<TSchema> }): Promise<unknown>

  protected override async run({ input }: ToolRun<TSchema>): Promise<ToolOutcome> {
    try {
      const body = await this.call({ input })
      if (body === undefined) {
        return {
          ok: true,
          output: null,
          modelText: `The control plane accepted the ${this.name} call.`,
        }
      }
      return { ok: true, output: body, modelText: present(body) }
    } catch (failure) {
      if (failure instanceof CloudError) return { ok: false, reason: failure.message }
      throw failure
    }
  }
}
