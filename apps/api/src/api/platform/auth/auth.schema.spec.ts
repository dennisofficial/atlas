import contract from '@dltech/atlas-db/contract.json'
import { getAuthTables } from 'better-auth/db'
import { describe, expect, it } from 'bun:test'
import { auth } from './auth.server'

type ContractColumn = { dataType: string; nullable: boolean; default?: unknown }
type ContractTable = {
  columns: Record<string, ContractColumn>
  primaryKey?: { columns: string[] }
  uniques: { columns: string[] }[]
  foreignKeys?: {
    onDelete?: string
    source: { columns: string[] }
    target: { columns: string[]; tableName: string }
  }[]
}

const contractTables: Record<string, ContractTable> =
  contract.storage.namespaces.public.entries.table

const dataTypeOf: Record<string, string> = {
  string: 'pg/text',
  boolean: 'pg/bool',
  date: 'pg/timestamptz',
  number: 'pg/int4',
  json: 'pg/jsonb',
}

const referentialActions: Record<string, string> = {
  cascade: 'cascade',
  'set null': 'setNull',
  restrict: 'restrict',
  'no action': 'noAction',
  'set default': 'setDefault',
}

const tables = getAuthTables(auth.options)
const modelNameOf = new Map(Object.entries(tables).map(([key, table]) => [key, table.modelName]))

describe('better-auth schema against the @dltech/atlas-db contract', () => {
  it('resolves every core and plugin model to a PascalCase table', () => {
    expect([...modelNameOf.values()].sort()).toEqual([
      'Account',
      'DeviceCode',
      'Invitation',
      'Member',
      'Organization',
      'Session',
      'User',
      'Verification',
    ])
  })

  for (const table of Object.values(tables)) {
    describe(table.modelName, () => {
      const contractTable = contractTables[table.modelName]

      it('is a contract table with an id primary key', () => {
        expect(contractTable).toBeDefined()
        expect(contractTable?.primaryKey?.columns).toEqual(['id'])
      })

      for (const [name, field] of Object.entries(table.fields)) {
        const columnName = field.fieldName ?? name

        it(`stores ${name} in a column of the right type and nullability`, () => {
          const column = contractTable?.columns[columnName]
          expect(column).toBeDefined()
          expect(column?.dataType).toBe(dataTypeOf[String(field.type)])
          expect(column?.nullable).toBe(field.required === false)
        })

        if (field.references) {
          const { references } = field
          it(`references ${references.model}.${references.field}`, () => {
            expect(contractTable?.foreignKeys).toContainEqual(
              expect.objectContaining({
                onDelete: referentialActions[references.onDelete ?? 'cascade'],
                source: expect.objectContaining({ columns: [columnName] }),
                target: expect.objectContaining({
                  columns: [references.field],
                  tableName: modelNameOf.get(references.model) ?? references.model,
                }),
              }),
            )
          })
        }

        if (field.unique) {
          it(`keeps ${name} unique`, () => {
            expect(contractTable?.uniques.map((unique) => unique.columns)).toContainEqual([
              columnName,
            ])
          })
        }
      }

      it('has no required column without a default that better-auth does not write', () => {
        const written = new Set([
          'id',
          ...Object.entries(table.fields).map(([name, field]) => field.fieldName ?? name),
        ])
        const unwritten = Object.entries(contractTable?.columns ?? {})
          .filter(([, column]) => !column.nullable && column.default === undefined)
          .map(([name]) => name)
          .filter((name) => !written.has(name))
        expect(unwritten).toEqual([])
      })
    })
  }
})
