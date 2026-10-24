import 'reflect-metadata'
import { metaOf, type ApiProcedureMeta } from '../../../_module/trpc/procedure-meta'

const PROCEDURE_METADATA_DESCRIPTION = 'trpc:procedure_metadata'

const isProcedureOptions = (value: unknown): value is { meta?: unknown } =>
  typeof value === 'object' && value !== null

export function procedureMetaOf(handler: object): ApiProcedureMeta {
  const key = Reflect.getMetadataKeys(handler).find(
    (candidate) =>
      typeof candidate === 'symbol' && candidate.description === PROCEDURE_METADATA_DESCRIPTION,
  )
  if (key === undefined) throw new Error('the handler is not a tRPC procedure')
  const options: unknown = Reflect.getMetadata(key, handler)
  return metaOf(isProcedureOptions(options) ? options.meta : undefined)
}
