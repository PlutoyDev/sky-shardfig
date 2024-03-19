import type { Redis } from '@upstash/redis';
import type { DailyShardConfig, GlobalShardConfig } from './types.js';
import { DateTime } from 'luxon';

export async function getGlobalShardConfig(
  redis: Redis
): Promise<GlobalShardConfig> {
  const res = await redis.mget<(string | null)[]>(
    'globalIsBugged',
    'globalBugType',
    'globalLastModified',
    'globalLastModifiedBy'
  );

  const [isBugged, bugType, lastModified, lastModifiedBy] = res;

  const globalShardConfig: GlobalShardConfig = { dailyMap: {} };

  if (isBugged) {
    globalShardConfig.isBugged = isBugged === 'true';
  }

  if (bugType) {
    globalShardConfig.bugType = bugType as 'inaccurate' | 'tgc :/';
  }

  if (lastModified) {
    globalShardConfig.lastModified = lastModified;
  }

  if (lastModifiedBy) {
    globalShardConfig.lastModifiedBy = lastModifiedBy;
  }

  return globalShardConfig;
}

export async function getDailyShardConfig(
  redis: Redis,
  date?: DateTime
): Promise<[string, DailyShardConfig] | undefined> {
  const isoDate =
    date?.toISODate() ??
    DateTime.now().setZone('America/Los_Angeles').toISODate();
  if (!isoDate) return undefined;

  const config = await redis.hgetall(`daily:${isoDate}`);

  if (config === null) return undefined;
  return [isoDate, config as DailyShardConfig];
}
