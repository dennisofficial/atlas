#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/798163a5e9fca8b08d9dd7a0622cee13a366ccfb761ff472c91f3721e959bd5a/contract';
import startContract from '../../snapshots/798163a5e9fca8b08d9dd7a0622cee13a366ccfb761ff472c91f3721e959bd5a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dd5251132749ee6f04164c0340a18da57bd5f862bc07c913bcba4eff8d2aed34/contract';
import endContract from '../../snapshots/dd5251132749ee6f04164c0340a18da57bd5f862bc07c913bcba4eff8d2aed34/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { backfillSessionModel } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      backfillSessionModel,
      this.setNotNull({ schema: 'v2', table: 'V2Session', column: 'modelEffort' }),
      this.setNotNull({ schema: 'v2', table: 'V2Session', column: 'modelFast' }),
      this.setNotNull({ schema: 'v2', table: 'V2Session', column: 'modelRef' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
