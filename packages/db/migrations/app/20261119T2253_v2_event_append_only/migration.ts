#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract';
import endContract from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract.json' with { type: 'json' };
import startContract from '../../snapshots/4406b81cac8b98381149af5769abd34522833966d2564835450f6715e509fe49/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/migration';

// V2Event is append-only: rewinds, compaction and forks append new rows or new threads, and
// sessions soft-delete, so no row is ever rewritten. Enforcing that in Postgres covers raw SQL and
// every client; the row trigger leaves TRUNCATE alone, which is how the test lane resets.
const appendOnlyGuard = rawSql({
  id: 'guard.v2-event-append-only',
  invariantId: 'v2-event-append-only',
  label: 'Refuse every UPDATE and DELETE of a V2Event row',
  operationClass: 'data',
  target: {
    id: 'table.V2Event',
    details: { schema: 'v2', objectType: 'table' as const, name: 'V2Event' },
  },
  precheck: [],
  execute: [
    {
      description: 'Create v2.V2Event_append_only() raising on any row mutation',
      sql: `CREATE OR REPLACE FUNCTION "v2"."V2Event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'V2Event is append-only: % refused for thread % seq %', TG_OP, OLD."threadId", OLD."seq"
    USING ERRCODE = 'restrict_violation';
END;
$$`,
    },
    {
      description: 'Drop any previous V2Event_append_only trigger',
      sql: 'DROP TRIGGER IF EXISTS "V2Event_append_only" ON "v2"."V2Event"',
    },
    {
      description: 'Create the BEFORE UPDATE OR DELETE row trigger on V2Event',
      sql: `CREATE TRIGGER "V2Event_append_only"
BEFORE UPDATE OR DELETE ON "v2"."V2Event"
FOR EACH ROW EXECUTE FUNCTION "v2"."V2Event_append_only"()`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [appendOnlyGuard];
  }
}

MigrationCLI.run(import.meta.url, M);
