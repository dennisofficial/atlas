#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/367f086b8ddb99bd89844b81e34832f7646b1c9538a860aa325459c59b3f3d84/contract';
import startContract from '../../snapshots/367f086b8ddb99bd89844b81e34832f7646b1c9538a860aa325459c59b3f3d84/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/88da44e40f871a45304a595208c1647379c125fc649092756d0091e8c48dc658/contract';
import endContract from '../../snapshots/88da44e40f871a45304a595208c1647379c125fc649092756d0091e8c48dc658/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'v2',
        table: 'V2Session',
        column: col('titledFromInboxId', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
