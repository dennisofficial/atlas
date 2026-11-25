import { rawSql } from '@prisma/orm-postgres/migration'

const INVARIANT = 'drop-v2-compat-views'

const VIEWS = [
  ['V2Blob', 'Blob'],
  ['V2BlobRef', 'BlobRef'],
  ['V2ChangeBlob', 'ChangeBlob'],
  ['V2ComposerDraft', 'SessionDraft'],
  ['V2ContextFile', 'ContextFile'],
  ['V2DiagramRepair', 'DiagramRepair'],
  ['V2Event', 'Event'],
  ['V2Host', 'Host'],
  ['V2InboxEntry', 'InboxEntry'],
  ['V2Lease', 'Lease'],
  ['Media', 'Media'],
  ['MediaSigningWindow', 'MediaSigningWindow'],
  ['V2PushDevice', 'PushDevice'],
  ['V2Routine', 'Routine'],
  ['V2RoutineRun', 'RoutineRun'],
  ['V2SandboxRun', 'SandboxRun'],
  ['V2Session', 'Session'],
  ['V2SessionBranch', 'SessionBranch'],
  ['V2SessionPullRequest', 'SessionPullRequest'],
  ['V2SessionView', 'SessionView'],
  ['V2Terminal', 'Terminal'],
  ['V2Thread', 'Thread'],
  ['V2WorktreeChangedFile', 'WorktreeChangedFile'],
  ['V2WorktreeChanges', 'WorktreeChanges'],
] as const

const quote = (name: string) => `"${name}"`
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`
const tableTarget = (schema: string, table: string) => ({
  id: 'postgres',
  details: { schema, objectType: 'table' as const, name: table },
})

const timeouts = rawSql({
  id: 'drop-v2-views.timeouts',
  invariantId: INVARIANT,
  label: 'Fail the deploy instead of waiting behind a long lock',
  operationClass: 'data',
  target: tableTarget('public', 'Session'),
  precheck: [],
  execute: [
    { description: 'bound the wait for ACCESS EXCLUSIVE locks', sql: "SET LOCAL lock_timeout = '5s'" },
  ],
  postcheck: [],
})

const dropViewOperation = ([oldName, table]: readonly [string, string]) =>
  rawSql({
    id: `drop-v2-views.drop.${oldName}`,
    label: `Drop the compatibility view v2.${quote(oldName)}`,
    operationClass: 'data',
    target: tableTarget('public', table),
    precheck: [],
    execute: [
      {
        description: `drop v2.${quote(oldName)} when it is a view, and refuse any other relation`,
        sql: `DO $$
DECLARE
  kind text;
BEGIN
  SELECT relkind::text INTO kind FROM pg_class WHERE oid = to_regclass(${literal(`v2.${quote(oldName)}`)});
  IF kind IS NULL THEN
    RETURN;
  END IF;
  IF kind <> 'v' THEN
    RAISE EXCEPTION 'refusing to drop %.%: relkind % is not a view', 'v2', ${literal(oldName)}, kind;
  END IF;
  EXECUTE ${literal(`DROP VIEW v2.${quote(oldName)}`)};
END
$$`,
      },
    ],
    postcheck: [
      {
        description: `v2.${quote(oldName)} is gone`,
        sql: `SELECT to_regclass(${literal(`v2.${quote(oldName)}`)}) IS NULL AS "result"`,
      },
    ],
  })

const dropSchema = rawSql({
  id: 'drop-v2-views.drop-schema',
  label: 'Drop the v2 schema once no relation is left in it',
  operationClass: 'data',
  target: tableTarget('public', 'Session'),
  precheck: [],
  execute: [
    {
      description: 'drop schema v2 without CASCADE, and refuse while a relation remains',
      sql: `DO $$
DECLARE
  remaining text;
BEGIN
  IF to_regnamespace('v2') IS NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(format('%s.%s (%s)', 'v2', c.relname, c.relkind), ', ' ORDER BY c.relname)
    INTO remaining
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'v2';
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to drop schema v2: relations remain: %', remaining;
  END IF;
  DROP SCHEMA IF EXISTS v2;
END
$$`,
    },
  ],
  postcheck: [
    {
      description: 'the v2 namespace is gone',
      sql: `SELECT to_regnamespace('v2') IS NULL AS "result"`,
    },
    {
      description: 'no relation lives in v2',
      sql: `SELECT count(*) = 0 AS "result"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'v2'`,
    },
  ],
})

export const dropOperations = () => [
  timeouts,
  ...VIEWS.map(dropViewOperation),
  dropSchema,
]
