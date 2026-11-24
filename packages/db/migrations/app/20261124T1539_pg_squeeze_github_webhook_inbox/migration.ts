#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract';
import endContract from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract.json' with { type: 'json' };
import startContract from '../../snapshots/f14deed4b0f53291f5db262e9f79d1b19487fd654b4842787af371390390c4bd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

// pg_squeeze 1.9.0, the first release for PostgreSQL 18, describes squeeze.tables.schedule as the
// composite (minutes, hours, days_of_month, months, days_of_week) where NULL matches any value, so
// ('{30}', '{9}', NULL, NULL, NULL) is 09:30 UTC every day. Only production preloads the library,
// so CREATE EXTENSION raises 0A000 where it is absent and the migration must not fail there.
// A package that leaves the contract untouched carries a self-edge, which the toolchain accepts
// only as a data operation that provides an invariant the db ref declares.
const scheduleGithubWebhookInbox = rawSql({
  id: 'extension.pg_squeeze',
  invariantId: 'pg-squeeze-github-webhook-inbox',
  label: 'Squeeze public.GithubWebhookInbox daily at 09:30 UTC',
  operationClass: 'data',
  target: {
    id: 'extension.pg_squeeze',
    details: { schema: 'public', objectType: 'dependency' as const, name: 'pg_squeeze' },
  },
  precheck: [],
  execute: [
    {
      description: 'Enable pg_squeeze where the server provides it and schedule GithubWebhookInbox',
      sql: `DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_squeeze;
  EXCEPTION
    WHEN undefined_file OR feature_not_supported OR object_not_in_prerequisite_state THEN
      RAISE NOTICE 'pg_squeeze not available, skipped';
  END;
  IF to_regclass('squeeze.tables') IS NULL THEN
    RAISE NOTICE 'pg_squeeze not available, skipped';
    RETURN;
  END IF;
  INSERT INTO squeeze.tables (tabschema, tabname, schedule)
  SELECT 'public', 'GithubWebhookInbox', ('{30}', '{9}', NULL, NULL, NULL)::squeeze.schedule
  WHERE NOT EXISTS (
    SELECT 1 FROM squeeze.tables WHERE tabschema = 'public' AND tabname = 'GithubWebhookInbox'
  );
END
$$`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [scheduleGithubWebhookInbox];
  }
}

MigrationCLI.run(import.meta.url, M);
