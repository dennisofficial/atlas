import { rawSql } from '@prisma/orm-postgres/migration'
import { SCHEMA_COMMENT, TABLE_COMMENTS } from './archive-comments'

const ARCHIVE_SCHEMA = 'v1_archive'
const ARCHIVED_TABLES = [
  'Session',
  'Thread',
  'Event',
  'Turn',
  'ThreadRead',
  'ContextFile',
  'SandboxBootStep',
  'CloudSandbox',
  'LocalPodLease',
  'PushDevice',
  'ComposerDraft',
  'OauthConnectionSandbox',
] as const

const quote = (name: string) => `"${name}"`
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`
const tableTarget = (schema: string, table: string) => ({
  id: 'postgres',
  details: { schema, objectType: 'table' as const, name: table },
})

const schemaOperation = rawSql({
  id: `schema.${ARCHIVE_SCHEMA}`,
  label: `Create the ${ARCHIVE_SCHEMA} schema and bound the lock wait`,
  operationClass: 'data',
  target: tableTarget('public', 'Session'),
  precheck: [],
  execute: [
    {
      description: 'fail the deploy rather than wait behind a long lock',
      sql: "SET LOCAL lock_timeout = '5s'",
    },
    {
      description: `create schema ${ARCHIVE_SCHEMA}`,
      sql: `CREATE SCHEMA IF NOT EXISTS ${ARCHIVE_SCHEMA}`,
    },
    {
      description: `document schema ${ARCHIVE_SCHEMA}`,
      sql: `COMMENT ON SCHEMA ${ARCHIVE_SCHEMA} IS ${literal(SCHEMA_COMMENT)}`,
    },
  ],
  postcheck: [
    {
      description: `verify schema ${ARCHIVE_SCHEMA} exists`,
      sql: `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = ${literal(ARCHIVE_SCHEMA)}) AS "result"`,
    },
  ],
})

const moveOperation = (table: string) =>
  rawSql({
    id: `move.${ARCHIVE_SCHEMA}.${table}`,
    label: `Move public.${quote(table)} to the ${ARCHIVE_SCHEMA} schema`,
    operationClass: 'data',
    target: tableTarget('public', table),
    precheck: [
      {
        description: `ensure table "${table}" exists in public`,
        sql: `SELECT to_regclass(${literal(`public.${quote(table)}`)}) IS NOT NULL AS "result"`,
      },
    ],
    execute: [
      {
        description: `move table "${table}" into ${ARCHIVE_SCHEMA} when it is still in public`,
        sql: `DO $$
BEGIN
  IF to_regclass(${literal(`public.${quote(table)}`)}) IS NOT NULL THEN
    ALTER TABLE public.${quote(table)} SET SCHEMA ${ARCHIVE_SCHEMA};
  END IF;
END
$$`,
      },
    ],
    postcheck: [
      {
        description: `verify table "${ARCHIVE_SCHEMA}.${table}" exists`,
        sql: `SELECT to_regclass(${literal(`${ARCHIVE_SCHEMA}.${quote(table)}`)}) IS NOT NULL AS "result"`,
      },
      {
        description: `verify table "public.${table}" is gone`,
        sql: `SELECT to_regclass(${literal(`public.${quote(table)}`)}) IS NULL AS "result"`,
      },
    ],
  })

const commentOperation = (table: string, columns: Record<string, string>) =>
  rawSql({
    id: `comment.${ARCHIVE_SCHEMA}.${table}`,
    label: `Document ${ARCHIVE_SCHEMA}.${quote(table)} and its columns`,
    operationClass: 'data',
    target: tableTarget(ARCHIVE_SCHEMA, table),
    precheck: [
      {
        description: `ensure table "${ARCHIVE_SCHEMA}.${table}" exists`,
        sql: `SELECT to_regclass(${literal(`${ARCHIVE_SCHEMA}.${quote(table)}`)}) IS NOT NULL AS "result"`,
      },
    ],
    execute: [
      {
        description: `comment on table "${table}"`,
        sql: [
          `COMMENT ON TABLE ${ARCHIVE_SCHEMA}.${quote(table)} IS ${literal(`v1 ${table} rows, frozen at retirement on 2026-11-25.`)}`,
          ...Object.entries(columns).map(
            ([column, meaning]) =>
              `COMMENT ON COLUMN ${ARCHIVE_SCHEMA}.${quote(table)}.${quote(column)} IS ${literal(meaning)}`,
          ),
        ].join(';\n'),
      },
    ],
    postcheck: [],
  })

export const archiveOperations = () => {
  const missing = ARCHIVED_TABLES.filter(
    (table) => !TABLE_COMMENTS.some((documented) => documented.table === table),
  )
  if (missing.length > 0) throw new Error(`no column documentation for ${missing.join(', ')}`)
  return [
    schemaOperation,
    ...ARCHIVED_TABLES.map(moveOperation),
    ...TABLE_COMMENTS.map((documented) =>
      commentOperation(documented.table, documented.columns),
    ),
  ]
}
