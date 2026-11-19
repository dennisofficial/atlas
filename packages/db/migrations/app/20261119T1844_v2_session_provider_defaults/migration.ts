#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/8ff92224609f6e96b53098608e35a84a6a8c06de5545ab4e1f85bdd0fc13579c/contract';
import startContract from '../../snapshots/8ff92224609f6e96b53098608e35a84a6a8c06de5545ab4e1f85bdd0fc13579c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/af6290442a7b8be9d49345d9f58eeed65ae2b185b86d669ed88710c02c9c7a50/contract';
import endContract from '../../snapshots/af6290442a7b8be9d49345d9f58eeed65ae2b185b86d669ed88710c02c9c7a50/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.setDefault({
        schema: 'v2',
        table: 'V2Session',
        column: col('credentialSource', 'text', {
          default: lit('byok'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.setDefault({
        schema: 'v2',
        table: 'V2Session',
        column: col('sandboxProvider', 'text', {
          default: lit('vercel'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
