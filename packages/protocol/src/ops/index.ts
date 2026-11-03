import { z } from 'zod'

import { execOpSchema } from './exec'
import {
  globOpSchema,
  grepOpSchema,
  mkdirOpSchema,
  readBytesOpSchema,
  readDirectoryOpSchema,
  readFileOpSchema,
  readTextForEditOpSchema,
  removeOpSchema,
  renameOpSchema,
  statOpSchema,
  writeFileOpSchema,
} from './files'

export const callOpSchema = z.discriminatedUnion('op', [
  execOpSchema,
  statOpSchema,
  readFileOpSchema,
  readBytesOpSchema,
  readTextForEditOpSchema,
  writeFileOpSchema,
  removeOpSchema,
  mkdirOpSchema,
  renameOpSchema,
  readDirectoryOpSchema,
  globOpSchema,
  grepOpSchema,
])

export type CallOp = z.infer<typeof callOpSchema>

export * from './exec'
export * from './files'
