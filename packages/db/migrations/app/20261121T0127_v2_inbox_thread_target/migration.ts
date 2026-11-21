#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract';
import endContract from '../../snapshots/146b406219be1abe18c62f1a1110703555fc61a7afece7555a592afb45e52c4b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/5e85d8cdcd62571cf9e061d2d249db49c7b6c39f6d336e6cb5e8b35a04d52b4b/contract';
import startContract from '../../snapshots/5e85d8cdcd62571cf9e061d2d249db49c7b6c39f6d336e6cb5e8b35a04d52b4b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2InboxEntry',
        column: col('threadId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'v2',
        table: 'V2InboxEntry',
        index: 'V2InboxEntry_thread_open',
        columns: ['threadId', 'sessionId', 'consumedSeq'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
