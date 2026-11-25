#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/48eae429cd208fd07b61e49b7abc76598096c07ec0528c1142d8fec838d5a974/contract';
import startContract from '../../snapshots/48eae429cd208fd07b61e49b7abc76598096c07ec0528c1142d8fec838d5a974/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract';
import endContract from '../../snapshots/f42fc9afa2a82c3afeffc94cdc6ed81c181325cd2eaae4b4d0e2dc2bccf31ac1/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import { moveOperations } from './move-steps';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return moveOperations();
  }
}

MigrationCLI.run(import.meta.url, M);
