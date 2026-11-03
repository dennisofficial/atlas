#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/aa1b7cae47cb713403ff8470e581f04f4da268821b153afa71bfdf55edf5768d/contract';
import endContract from '../../snapshots/aa1b7cae47cb713403ff8470e581f04f4da268821b153afa71bfdf55edf5768d/contract.json' with { type: 'json' };
import startContract from '../../snapshots/aa1b7cae47cb713403ff8470e581f04f4da268821b153afa71bfdf55edf5768d/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { backfillSkillsFromUserFiles } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [backfillSkillsFromUserFiles];
  }
}

MigrationCLI.run(import.meta.url, M);
