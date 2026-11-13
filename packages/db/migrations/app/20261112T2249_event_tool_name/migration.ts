#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/7ce0c6e07746aaadcecc5813280a9591cb44eef6894cd5d7cb28a8e9782c2d4e/contract';
import startContract from '../../snapshots/7ce0c6e07746aaadcecc5813280a9591cb44eef6894cd5d7cb28a8e9782c2d4e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract';
import endContract from '../../snapshots/db9883fc7594d4a56041e19c67ee2bc21db9bf9fd2e454a4e93a2de083606340/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, rawSql } from '@prisma/orm-postgres/migration';

const backfillToolName = rawSql({
  id: 'data.event-tool-name-backfill',
  label: 'Backfill Event.toolName from the body of recent tool-called events',
  operationClass: 'data',
  target: {
    id: 'table.Event',
    details: { schema: 'public', objectType: 'table' as const, name: 'Event' },
  },
  precheck: [],
  execute: [
    {
      description: 'Backfill Event.toolName from the body name of tool-called events',
      sql: `UPDATE "Event" SET "toolName" = CASE WHEN pg_input_is_valid(body, 'jsonb') THEN body::jsonb ->> 'name' END
WHERE type = 'tool-called' AND "toolName" IS NULL AND at > now() - interval '31 days' AND pg_input_is_valid(body, 'jsonb')`,
    },
  ],
  postcheck: [],
});

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Event',
        column: col('toolName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      backfillToolName,
      this.createIndex({
        schema: 'public',
        table: 'Event',
        index: 'Event_userId_contextSlot_at_idx',
        columns: ['userId', 'contextSlot', 'at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'Event',
        index: 'Event_userId_type_toolName_at_idx',
        columns: ['userId', 'type', 'toolName', 'at'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
