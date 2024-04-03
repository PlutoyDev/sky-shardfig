import type { Redis } from '@upstash/redis';
import { DateTime, Duration } from 'luxon';

export const memories = ['Jellyfish', 'Crab', 'Manta', 'Krill', 'Whale', 'Elder'] as const;

export const commonOverrideReasons = {
  event_area: 'Disabled due to event occuring in the area',
  bugged_shard: 'Bugged, Shard not working',
  bugged_memory: "Can't access the memory",
  tgc_altered: 'Altered by TGC',
};

export interface Override {
  hasShard?: boolean;
  isRed?: boolean;
  group?: number;
  realm?: number;
  map?: string;
}

const landOffset = Duration.fromObject({ minutes: 8, seconds: 40 }); //after start
const endOffset = Duration.fromObject({ hours: 4 }); //after start

const blackShardInterval = Duration.fromObject({ hours: 8 });
const redShardInterval = Duration.fromObject({ hours: 6 });

export const stringsEn = {
  skyRealms: {
    prairie: 'Daylight Prairie',
    forest: 'Hidden Forest',
    valley: 'Valley of Triumph',
    wasteland: 'Golden Wasteland',
    vault: 'Vault of Knowledge',
  },
  skyMaps: {
    'prairie.butterfly': 'Butterfly Fields',
    'prairie.village': 'Village Islands',
    'prairie.cave': 'Cave',
    'prairie.bird': 'Bird Nest',
    'prairie.island': 'Sanctuary Island',
    'forest.brook': 'Brook',
    'forest.boneyard': 'Boneyard',
    'forest.end': 'Forest Garden',
    'forest.tree': 'Treehouse',
    'forest.sunny': 'Elevated Clearing',
    'valley.rink': 'Ice Rink',
    'valley.dreams': 'Village of Dreams',
    'valley.hermit': 'Hermit valley',
    'wasteland.temple': 'Broken Temple',
    'wasteland.battlefield': 'Battlefield',
    'wasteland.graveyard': 'Graveyard',
    'wasteland.crab': 'Crab Field',
    'wasteland.ark': 'Forgotten Ark',
    'vault.starlight': 'Starlight Desert',
    'vault.jelly': 'Jellyfish Cove',
  },
};

export const realms = ['prairie', 'forest', 'valley', 'wasteland', 'vault'] as const;

interface ShardConfig {
  noShardWkDay: number[];
  offset: Duration;
  interval: Duration;
  maps: [string, string, string, string, string];
  defRewardAC?: number;
}

// prettier-ignore
export const shardsInfo = [
  {
    noShardWkDay: [6, 7], //Sat;Sun
    interval: blackShardInterval,
    offset: Duration.fromObject({ hours: 1, minutes: 50 }),
    maps: ['prairie.butterfly', 'forest.brook', 'valley.rink', 'wasteland.temple', 'vault.starlight'],
  },
  {
    noShardWkDay: [7, 1], //Sun;Mon
    interval: blackShardInterval,
    offset: Duration.fromObject({ hours: 2, minutes: 10 }),
    maps: ['prairie.village', 'forest.boneyard', 'valley.rink', 'wasteland.battlefield', 'vault.starlight'],
  },
  {
    noShardWkDay: [1, 2], //Mon;Tue
    interval: redShardInterval,
    offset: Duration.fromObject({ hours: 7, minutes: 40 }),
    maps: ['prairie.cave', 'forest.end', 'valley.dreams', 'wasteland.graveyard', 'vault.jelly'],
    defRewardAC: 2,
  },
  {
    noShardWkDay: [2, 3], //Tue;Wed
    interval: redShardInterval,
    offset: Duration.fromObject({ hours: 2, minutes: 20 }),
    maps: ['prairie.bird', 'forest.tree', 'valley.dreams', 'wasteland.crab', 'vault.jelly'],
    defRewardAC: 2.5,
  },
  {
    noShardWkDay: [3, 4], //Wed;Thu
    interval: redShardInterval,
    offset: Duration.fromObject({ hours: 3, minutes: 30 }),
    maps: ['prairie.island', 'forest.sunny', 'valley.hermit', 'wasteland.ark', 'vault.jelly'],
    defRewardAC: 3.5,
  },
] satisfies ShardConfig[];

const overrideRewardAC: Record<string, number> = {
  'forest.end': 2.5,
  'valley.dreams': 2.5,
  'forest.tree': 3.5,
  'vault.jelly': 3.5,
};

// Used to validate variation input, not listed = 1
export const numMapVarients = {
  'prairie.butterfly': 3,
  'prairie.village': 3,
  'prairie.bird': 2,
  'prairie.island': 3,
  'forest.brook': 2,
  'forest.end': 2,
  'valley.rink': 3,
  'valley.dreams': 2,
  'wateland.temple': 3,
  'wasteland.battlefield': 3,
  'wasteland.graveyard': 2,
  'wasteland.crab': 2,
  'wasteland.ark': 4,
  'vault.starlight': 3,
  'vault.jelly': 2,
};

export function getShardInfo(date: DateTime, override?: Override) {
  const today = date.setZone('America/Los_Angeles').startOf('day');
  const [dayOfMth, dayOfWk] = [today.day, today.weekday];
  const isRed = override?.isRed ?? dayOfMth % 2 === 1;
  const realmIdx = override?.realm ?? (dayOfMth - 1) % 5;
  const infoIndex = override?.group ?? (dayOfMth % 2 === 1 ? (((dayOfMth - 1) / 2) % 3) + 2 : (dayOfMth / 2) % 2);
  const { noShardWkDay, interval, offset, maps, defRewardAC } = shardsInfo[infoIndex];
  const hasShard = override?.hasShard ?? !noShardWkDay.includes(dayOfWk);
  const map = override?.map ?? maps[realmIdx];
  const rewardAC = isRed ? overrideRewardAC[map] ?? defRewardAC : undefined;
  const numVarient = numMapVarients[map as keyof typeof numMapVarients] ?? 1;
  let firstStart = today.plus(offset);
  //Detect timezone changed, happens on Sunday, shardInfoIdx is 2,3 or 4. Offset > 2hrs
  if (dayOfWk === 7 && today.isInDST !== firstStart.isInDST) {
    firstStart = firstStart.plus({ hours: firstStart.isInDST ? -1 : 1 });
  }
  const occurrences = Array.from({ length: 3 }, (_, i) => {
    const start = firstStart.plus(interval.mapUnits(x => x * i));
    const land = start.plus(landOffset);
    const end = start.plus(endOffset);
    return { start, land, end };
  });
  return {
    date,
    isRed,
    hasShard,
    group: infoIndex,
    offset,
    interval,
    lastEnd: occurrences[2].end,
    realm: realmIdx,
    map,
    numVarient,
    rewardAC,
    occurrences,
  };
}

export type ShardInfo = ReturnType<typeof getShardInfo>;

export interface DailyConfig {
  memory?: number | null;
  memoryBy?: string | null;
  variation?: number | null;
  variationBy?: string | null;
  override?: Override | null;
  overrideBy?: string | null;
  overrideReason?: string | null;
  version?: number;
  lastModified?: DateTime;
}

export interface DailyConfigFromRedis {
  memory?: string;
  memoryBy?: string;
  variation?: string;
  variationBy?: string;
  override?: string;
  overrideBy?: string;
  overrideReason?: string;
  version?: string;
  lastModified?: string;
}

export async function getDailyConfig<
  Keys extends (keyof DailyConfig)[] = [
    'memory',
    'memoryBy',
    'variation',
    'variationBy',
    'override',
    'overrideBy',
    'overrideReason',
    'lastModified',
  ],
>(
  redis: Redis,
  date: DateTime | string,
  keys?: Keys,
): Promise<Pick<DailyConfigFromRedis, Keys[number]> | DailyConfigFromRedis | undefined> {
  if (typeof date !== 'string') date = date.toISODate() as string;
  if (!date) return undefined;
  const hashKey = `daily:${date}`;
  if (!keys) {
    return (await redis.hgetall(hashKey)) as DailyConfigFromRedis;
  }

  return (await redis.hmget(hashKey, ...keys)) as Pick<DailyConfigFromRedis, Keys[number]>;
}

export async function getParsedDailyConfig<Keys extends (keyof DailyConfig)[]>(
  redis: Redis,
  date: DateTime | string,
  keys?: Keys,
) {
  const config = (await getDailyConfig(redis, date, keys)) as DailyConfigFromRedis | undefined;
  if (!config) return undefined;

  const parsedConfig: DailyConfig = {};
  if (config.memory) parsedConfig.memory = parseInt(config.memory);
  if (config.memoryBy) parsedConfig.memoryBy = config.memoryBy;
  if (config.variation) parsedConfig.variation = parseInt(config.variation);
  if (config.variationBy) parsedConfig.variationBy = config.variationBy;
  if (config.override) parsedConfig.override = JSON.parse(config.override);
  if (config.overrideBy) parsedConfig.overrideBy = config.overrideBy;
  if (config.overrideReason) parsedConfig.overrideReason = config.overrideReason;
  if (config.version) parsedConfig.version = parseInt(config.version);
  if (config.lastModified) parsedConfig.lastModified = DateTime.fromISO(config.lastModified);

  if (!keys) return parsedConfig as DailyConfig;
  return parsedConfig as Pick<DailyConfig, Keys[number]>;
}

export async function setDailyConfig(
  redis: Redis,
  date: DateTime,
  config: Omit<DailyConfig, 'lastModified' | 'version' | 'memoryBy' | 'variationBy' | 'overrideBy'>,
  authorId: string,
) {
  const isoDate = date.toISODate();
  if (!isoDate) throw new Error('Invalid date');
  if (
    config.memory === undefined &&
    config.variation === undefined &&
    config.override === undefined &&
    !config.overrideReason
  ) {
    throw new Error('No changes to set');
  }

  // TODO: Add action log

  const { memory, variation, override, overrideReason } = config;
  const editedField: (keyof DailyConfig)[] = [];
  const delField: (keyof DailyConfig)[] = [];
  const configStringified: DailyConfigFromRedis = {};

  if (memory !== undefined) {
    editedField.push('memory');
    if (memory) {
      configStringified.memory = memory.toString();
      configStringified.memoryBy = authorId;
    } else delField.push('memory', 'memoryBy');
  }

  if (variation !== undefined) {
    editedField.push('variation');
    if (variation) {
      configStringified.variation = variation.toString();
      configStringified.variationBy = authorId;
    } else delField.push('variation', 'variationBy');
  }

  if (overrideReason !== undefined) {
    editedField.push('overrideReason');
    if (overrideReason) {
      configStringified.overrideReason = overrideReason;
    } else delField.push('overrideReason');
  }

  if (override !== undefined) {
    editedField.push('override');
    if (override) {
      configStringified.override = JSON.stringify(config.override);
      configStringified.overrideBy = authorId;
    } else delField.push('override', 'overrideBy');
  }

  configStringified.lastModified = DateTime.now().toISO();

  const hashKey = `daily:${isoDate}`;
  await Promise.all([
    redis.hmset(hashKey, configStringified as Record<string, string>),
    redis.sadd('edited_fields', ...editedField.map(k => hashKey + ':' + k)),
    delField.length > 0 ? redis.hdel(hashKey, ...delField) : Promise.resolve(),
  ]);

  await redis.hincrby(`daily:${isoDate}`, 'version', 1);
}

export interface GlobalConfig {
  // This controls the global state of the application
  bugged?: boolean;
  buggedReason?: string;
}

export async function getGlobalShardConfig(redis: Redis): Promise<GlobalConfig | undefined> {
  const config = await redis.hgetall<Record<keyof GlobalConfig, string>>('global');
  if (!config) return undefined;
  if (config.bugged && config.bugged === 'true') {
    return { bugged: true, buggedReason: config.buggedReason };
  } else return undefined;
}

export async function setGlobalShardConfig(redis: Redis, data: GlobalConfig) {
  if (data.bugged) {
    if (!data.buggedReason) throw new Error('Missing reason for setting bugged state');
    await redis.hset('global', {
      bugged: true,
      buggedReason: data.buggedReason,
    });
  } else redis.del('global');

  await redis.sadd('edited_fields', 'global');
}

export async function pushAuthorName(redis: Redis, authorId: string, authorName: string) {
  await redis.hset('author_names', { [authorId]: authorName });
}

export async function getAuthorNames(redis: Redis) {
  const authorNames = await redis.hgetall('author_names');
  if (!authorNames) return {};
  return authorNames as Record<string, string>;
}

export interface RemoteConfigResponse {
  dailiesMap: Record<string, DailyConfig>;
  authorNames: Record<string, string>;
  global?: GlobalConfig;
}
