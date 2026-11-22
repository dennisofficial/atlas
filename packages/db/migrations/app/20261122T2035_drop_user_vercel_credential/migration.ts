#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract';
import startContract from '../../snapshots/027a78bb580bcea4fac8bb1e13e9e3c2ed1ba065836bc46e2fbd208264a5c275/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract';
import endContract from '../../snapshots/3e34f4cf3a0384ac6ed67d1108e74534a33a20a41f7eecd38f6c47c64598ef94/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'UserVercelCredential' }),
      this.setDefault({
        schema: 'v2',
        table: 'V2Session',
        column: col('credentialSource', 'text', {
          default: lit('platform'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
