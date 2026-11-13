#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3821d957264a300b689ea27e09e7806db77dd6015b5f3a6b39e93c36cb30b0f8/contract';
import endContract from '../../snapshots/3821d957264a300b689ea27e09e7806db77dd6015b5f3a6b39e93c36cb30b0f8/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract';
import startContract from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropColumn({ schema: 'v2', table: 'V2OperatorRequest', column: 'secret' })];
  }
}

MigrationCLI.run(import.meta.url, M);
