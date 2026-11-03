#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/016fa1c833e109cf4144ef62082fdab50548ec380c0f5927f2acbb0d84c74729/contract';
import endContract from '../../snapshots/016fa1c833e109cf4144ef62082fdab50548ec380c0f5927f2acbb0d84c74729/contract.json' with { type: 'json' };
import startContract from '../../snapshots/016fa1c833e109cf4144ef62082fdab50548ec380c0f5927f2acbb0d84c74729/contract.json' with { type: 'json' };
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
