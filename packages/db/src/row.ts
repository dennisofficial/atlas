import type { Scalars } from '@prisma/orm-postgres/family-contract/types'
import type { models } from './prisma/schema/contract'

type PublicModels = (typeof models)['public']

export type ModelName = keyof PublicModels

export type Row<Name extends ModelName> = Scalars<PublicModels[Name]>
