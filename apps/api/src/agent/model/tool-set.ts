import { tool, type ToolSet } from 'ai'

import type { ToolDeclaration } from '@dltech/atlas-core'

import { providerSafeSchema } from './vacuous-property-names'

export const toToolSet = (declarations: readonly ToolDeclaration[]): ToolSet =>
  Object.fromEntries(
    declarations.map((declaration) => [
      declaration.name,
      tool({
        description: declaration.description,
        strict: false,
        inputSchema: providerSafeSchema({
          inputSchema: declaration.inputSchema,
          rawJsonSchema: declaration.jsonSchema,
        }),
      }),
    ]),
  )
