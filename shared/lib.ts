import type { Redis } from '@upstash/redis';
import { DateTime } from 'luxon';

export const memories = [
  'Jellyfish',
  'Crab',
  'Manta',
  'Krill',
  'Whale',
  'Elder',
] as const;

export interface DailyShardConfig {
  memory?: number;
  variation?: number;
  isBugged?: boolean;
  bugType?: 'noShard' | 'noMemory';
  isDisabled?: boolean;
  disabledReason?: string;
  credits?: string[];
  lastModified?: string;
  lastModifiedBy?: string;
}

export interface DailyShardConfigStringified {
  memory?: string;
  variation?: string;
  isBugged?: string;
  bugType?: string;
  isDisabled?: string;
  disabledReason?: string;
  credits?: string;
  lastModified?: string;
  lastModifiedBy?: string;
}

export function parseDailyConfig(
  dailyShardConfig: DailyShardConfigStringified
): DailyShardConfig {
  return {
    memory: dailyShardConfig.memory
      ? parseInt(dailyShardConfig.memory)
      : undefined,
    variation: dailyShardConfig.variation
      ? parseInt(dailyShardConfig.variation)
      : undefined,
    isBugged: dailyShardConfig.isBugged === 'true',
    bugType: dailyShardConfig.bugType as 'noShard' | 'noMemory' | undefined,
    isDisabled: dailyShardConfig.isDisabled === 'true',
    disabledReason: dailyShardConfig.disabledReason,
    credits: dailyShardConfig.credits
      ? dailyShardConfig.credits.split(',')
      : undefined,
    lastModified: dailyShardConfig.lastModified,
    lastModifiedBy: dailyShardConfig.lastModifiedBy,
  };
}

export interface GlobalShardConfig {
  dailyMap: Record<string, DailyShardConfig>; //key = yyyy-mm-dd
  isBugged?: boolean;
  bugType?: 'inaccurate' | 'tgc :/';
  lastModified?: string;
  lastModifiedBy?: string;
}

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
): Promise<[string, DailyShardConfigStringified] | undefined> {
  const isoDate =
    date?.toISODate() ??
    DateTime.now().setZone('America/Los_Angeles').toISODate();
  if (!isoDate) return undefined;

  const config = await redis.hgetall(`daily:${isoDate}`);

  if (config === null) return undefined;
  return [isoDate, config as DailyShardConfigStringified];
}

export async function getParsedDailyShardConfig<
  Keys extends (keyof DailyShardConfig)[]
>(
  redis: Redis,
  keys: Keys,
  date?: DateTime
): Promise<Pick<DailyShardConfig, Keys[number]>> {
  date ??= DateTime.now().setZone('America/Los_Angeles');

  const isoDate = date.toISODate();
  if (!isoDate) {
    return Object.fromEntries(keys.map(key => [key, undefined])) as Pick<
      DailyShardConfig,
      Keys[number]
    >;
  }

  const config = await redis.hmget(`daily:${isoDate}`, ...keys);
  if (config === null) {
    return Object.fromEntries(keys.map(key => [key, undefined])) as Pick<
      DailyShardConfig,
      Keys[number]
    >;
  }
  return parseDailyConfig(config as DailyShardConfigStringified) as Pick<
    DailyShardConfig,
    Keys[number]
  >;
}
