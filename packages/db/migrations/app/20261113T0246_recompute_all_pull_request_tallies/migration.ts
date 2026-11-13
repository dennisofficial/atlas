#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract';
import endContract from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract.json' with { type: 'json' };
import startContract from '../../snapshots/a1d7da1e092b7832619e7438fc84a790bd3244eaf29625754bd2ee821901b4e2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { recomputeAllPullRequestTallies } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [recomputeAllPullRequestTallies];
  }
}

MigrationCLI.run(import.meta.url, M);
