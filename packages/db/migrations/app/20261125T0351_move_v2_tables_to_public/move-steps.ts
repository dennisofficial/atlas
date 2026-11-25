import { rawSql } from '@prisma/orm-postgres/migration'

const MOVED_TABLES = [
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
const relkindCheck = (schema: string, table: string, kind: string) => ({
  description: `ensure ${schema}.${quote(table)} has relkind ${kind}`,
  sql: `SELECT (SELECT relkind FROM pg_class WHERE oid = to_regclass(${literal(`${schema}.${quote(table)}`)})) = ${literal(kind)} AS "result"`,
})

const timeouts = rawSql({
  id: 'v2-to-public.timeouts',
  label: 'Fail the deploy instead of waiting behind a long lock',
  operationClass: 'data',
  target: tableTarget('v2', 'V2Session'),
  precheck: [],
  execute: [
    { description: 'bound the wait for ACCESS EXCLUSIVE locks', sql: "SET LOCAL lock_timeout = '5s'" },
    { description: 'bound the whole transaction', sql: "SET LOCAL statement_timeout = '60s'" },
  ],
  postcheck: [],
})

const moveOperation = ([from, to]: readonly [string, string]) =>
  rawSql({
    id: `v2-to-public.move.${from}`,
    label: `Move v2.${quote(from)} to public.${quote(to)}`,
    operationClass: 'data',
    target: tableTarget('v2', from),
    precheck: [],
    execute: [
      {
        description: `rename and move "${from}" when it is still a table in v2`,
        sql: `DO $$
BEGIN
  IF to_regclass(${literal(`v2.${quote(from)}`)}) IS NOT NULL
     AND (SELECT relkind FROM pg_class WHERE oid = to_regclass(${literal(`v2.${quote(from)}`)})) = 'r' THEN
    ${from === to ? '' : `EXECUTE ${literal(`ALTER TABLE v2.${quote(from)} RENAME TO ${quote(to)}`)};`}
    EXECUTE ${literal(`ALTER TABLE v2.${quote(to)} SET SCHEMA public`)};
  END IF;
END
$$`,
      },
    ],
    postcheck: [relkindCheck('public', to, 'r')],
  })

const viewOperation = ([from, to]: readonly [string, string]) =>
  rawSql({
    id: `v2-to-public.view.${from}`,
    label: `Keep v2.${quote(from)} readable and writable as a view over public.${quote(to)}`,
    operationClass: 'data',
    target: tableTarget('public', to),
    precheck: [],
    execute: [
      {
        description: `create view v2.${quote(from)} when no relation holds that name`,
        sql: `DO $$
BEGIN
  IF to_regclass(${literal(`v2.${quote(from)}`)}) IS NULL THEN
    EXECUTE ${literal(`CREATE VIEW v2.${quote(from)} AS SELECT * FROM public.${quote(to)}`)};
  END IF;
END
$$`,
      },
    ],
    postcheck: [relkindCheck('v2', from, 'v')],
  })

const renameTerminalStateCheck = rawSql({
  id: 'v2-to-public.rename.terminal-state-check',
  label: 'Rename the Terminal state check to the name its model derives',
  operationClass: 'data',
  target: tableTarget('public', 'Terminal'),
  precheck: [],
  execute: [
    {
      description: 'rename the constraint when it still carries the old table prefix',
      sql: `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'V2Terminal_state_check_5a2da7a7'
                AND conrelid = 'public."Terminal"'::regclass) THEN
    EXECUTE 'ALTER TABLE public."Terminal" RENAME CONSTRAINT "V2Terminal_state_check_5a2da7a7" TO "Terminal_state_check_5a2da7a7"';
  END IF;
END
$$`,
    },
  ],
  postcheck: [
    {
      description: 'the check now carries the new name',
      sql: `SELECT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conname = 'Terminal_state_check_5a2da7a7'
                           AND conrelid = 'public."Terminal"'::regclass) AS "result"`,
    },
  ],
})

const appendOnlyFunction = rawSql({
  id: 'v2-to-public.event-append-only-function',
  label: 'Recreate the append-only guard function in public',
  operationClass: 'data',
  target: tableTarget('public', 'Event'),
  precheck: [relkindCheck('public', 'Event', 'r')],
  execute: [
    {
      description: 'create public.Event_append_only() raising on any row mutation',
      sql: `CREATE OR REPLACE FUNCTION public."Event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Event is append-only: % refused for thread % seq %', TG_OP, OLD."threadId", OLD."seq"
    USING ERRCODE = 'restrict_violation';
END;
$$`,
    },
  ],
  postcheck: [],
})

const appendOnlyTrigger = rawSql({
  id: 'v2-to-public.event-append-only-trigger',
  label: 'Guard public."Event" against UPDATE and DELETE before the old trigger goes',
  operationClass: 'data',
  target: tableTarget('public', 'Event'),
  precheck: [relkindCheck('public', 'Event', 'r')],
  execute: [
    { description: 'drop any previous trigger of the new name', sql: 'DROP TRIGGER IF EXISTS "Event_append_only" ON public."Event"' },
    {
      description: 'create the BEFORE UPDATE OR DELETE row trigger on public."Event"',
      sql: `CREATE TRIGGER "Event_append_only"
BEFORE UPDATE OR DELETE ON public."Event"
FOR EACH ROW EXECUTE FUNCTION public."Event_append_only"()`,
    },
  ],
  postcheck: [],
})

const appendOnlyCleanup = rawSql({
  id: 'v2-to-public.event-append-only-cleanup',
  label: 'Drop the v2-era trigger and its function',
  operationClass: 'data',
  target: tableTarget('public', 'Event'),
  precheck: [relkindCheck('public', 'Event', 'r')],
  execute: [
    { description: 'drop the trigger that followed the table out of v2', sql: 'DROP TRIGGER IF EXISTS "V2Event_append_only" ON public."Event"' },
    { description: 'drop the v2 function', sql: 'DROP FUNCTION IF EXISTS v2."V2Event_append_only"()' },
  ],
  postcheck: [],
})

const noBaseTableLeftBehind = rawSql({
  id: 'v2-to-public.postcheck.empty-schema',
  label: 'Prove no base table is left in the v2 schema',
  operationClass: 'data',
  target: tableTarget('public', 'Session'),
  precheck: [],
  execute: [{ description: 'nothing to change: this operation only proves the end state', sql: 'SELECT 1' }],
  postcheck: [
    {
      description: 'the v2 schema holds views only',
      sql: `SELECT count(*) = 0 AS "result"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'v2' AND c.relkind = 'r'`,
    },
  ],
})

export const moveOperations = () => [
  timeouts,
  ...MOVED_TABLES.map(moveOperation),
  ...MOVED_TABLES.map(viewOperation),
  renameTerminalStateCheck,
  appendOnlyFunction,
  appendOnlyTrigger,
  appendOnlyCleanup,
  noBaseTableLeftBehind,
]
