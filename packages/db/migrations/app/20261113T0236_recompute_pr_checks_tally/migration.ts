#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract';
import endContract from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract.json' with { type: 'json' };
import startContract from '../../snapshots/d232f37cbb4ac571f07d4879ffa697bf5acfd9888297ff6e7b6d47651a2d9850/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { recomputeOpenPullRequestTallies } from './data-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [recomputeOpenPullRequestTallies];
  }
}

MigrationCLI.run(import.meta.url, M);
