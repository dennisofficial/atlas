#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1f29b6b2d37c5afc2213f8109458d7518b4f21d3304c9b367f1526917851a586/contract';
import endContract from '../../snapshots/1f29b6b2d37c5afc2213f8109458d7518b4f21d3304c9b367f1526917851a586/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e07ae9a598861423b56f58f537da83035af72b4444e26e28b3f1a1617fd53574/contract';
import startContract from '../../snapshots/e07ae9a598861423b56f58f537da83035af72b4444e26e28b3f1a1617fd53574/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropIndex({
        schema: 'public',
        table: 'SandboxBootStep',
        index: 'SandboxBootStep_sessionId_at_idx',
      }),
      this.addColumn({
        schema: 'public',
        table: 'SandboxBootStep',
        column: col('repos', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'SandboxBootStep',
        column: col('seq', 'BIGSERIAL', { notNull: true, codecRef: { codecId: 'pg/int8@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'SandboxBootStep',
        index: 'SandboxBootStep_sessionId_seq_idx',
        columns: ['sessionId', 'seq'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
