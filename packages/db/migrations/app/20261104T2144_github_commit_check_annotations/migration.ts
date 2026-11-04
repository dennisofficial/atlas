#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/9865c08ee43a57502ce30d8b837cb2a0804e8ee760f59f39d85758b15b4121fb/contract';
import endContract from '../../snapshots/9865c08ee43a57502ce30d8b837cb2a0804e8ee760f59f39d85758b15b4121fb/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f9d1545e96be8e862d435b7b8e1f6e87f907a2cec641ec26742b6c0e93726e5e/contract';
import startContract from '../../snapshots/f9d1545e96be8e862d435b7b8e1f6e87f907a2cec641ec26742b6c0e93726e5e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('annotations', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'GithubCommitCheck',
        column: col('annotationsCount', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
