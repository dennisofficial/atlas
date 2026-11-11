#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract';
import endContract from '../../snapshots/a04df9006767473ac4a56cce0bc21d144268ba24e28d5e1982fc2e71496f36f2/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/de1257f050bc3d136fa91828788d6c4c5af6c2cc0b22bcd66f942b8831d9bb72/contract';
import startContract from '../../snapshots/de1257f050bc3d136fa91828788d6c4c5af6c2cc0b22bcd66f942b8831d9bb72/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addRequiredColumnToEmptyTable({
        schema: 'public',
        table: 'Artifact',
        column: 'subdomain',
        type: 'text',
      }),
      this.addUnique({
        schema: 'public',
        table: 'Artifact',
        constraint: 'Artifact_subdomain_key',
        columns: ['subdomain'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
