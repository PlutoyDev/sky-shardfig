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

export const commonOverrideReasons = {
  event_area: 'Disabled due to event occuring in the area',
  bugged_shard: 'Bugged, Shard not working',
  bugged_memory: "Can't access the memory",
  tgc_altered: 'Altered by TGC',
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

export function getShardMapInfo(date: DateTime) {
  const dayOfMth = date.day;
  const isRed = dayOfMth % 2 === 0;
  const realmIndex = dayOfMth % 5;
  const mapSetIndex = isRed
    ? (((dayOfMth - 1) / 2) % 3) + 2
    : (dayOfMth / 2) % 2;
  // prettier-ignore
  const map = ([
    ['prairie.butterfly', 'forest.brook', 'valley.rink', 'wasteland.temple', 'vault.starlight'],
    ['prairie.village', 'forest.boneyard', 'valley.rink', 'wasteland.battlefield', 'vault.starlight'],
    ['prairie.cave', 'forest.end', 'valley.dreams', 'wasteland.graveyard', 'vault.jelly'],
    ['prairie.bird', 'forest.tree', 'valley.dreams', 'wasteland.crab', 'vault.jelly'],
    ['prairie.island', 'forest.sunny', 'valley.hermit', 'wasteland.ark', 'vault.jelly'],
  ])[mapSetIndex][realmIndex];
  const numVariants = numMapVarients[map as keyof typeof numMapVarients] ?? 1;
  return { map, numVariants };
}

export interface DailyConfig {
  memory?: number | null;
  memoryBy?: string | null;
  variation?: number | null;
  variationBy?: string | null;
  override?: {
    hasShard?: boolean;
    isRed?: boolean;
    realm?: number;
    map?: string;
    offset?: number;
  } | null;
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
    'lastModified'
  ]
>(
  redis: Redis,
  date: DateTime | string,
  keys?: Keys
): Promise<
  Pick<DailyConfigFromRedis, Keys[number]> | DailyConfigFromRedis | undefined
> {
  if (typeof date !== 'string') date = date.toISODate() as string;
  if (!date) return undefined;
  const hashKey = `daily:${date}`;
  if (!keys) {
    return (await redis.hgetall(hashKey)) as DailyConfigFromRedis;
  }

  return (await redis.hmget(hashKey, ...keys)) as Pick<
    DailyConfigFromRedis,
    Keys[number]
  >;
}

export async function getParsedDailyConfig<Keys extends (keyof DailyConfig)[]>(
  redis: Redis,
  date: DateTime | string,
  keys?: Keys
) {
  const config = (await getDailyConfig(redis, date, keys)) as
    | DailyConfigFromRedis
    | undefined;
  if (!config) return undefined;

  const parsedConfig: DailyConfig = {};
  if (config.memory) parsedConfig.memory = parseInt(config.memory);
  if (config.memoryBy) parsedConfig.memoryBy = config.memoryBy;
  if (config.variation) parsedConfig.variation = parseInt(config.variation);
  if (config.variationBy) parsedConfig.variationBy = config.variationBy;
  if (config.override) parsedConfig.override = JSON.parse(config.override);
  if (config.overrideBy) parsedConfig.overrideBy = config.overrideBy;
  if (config.overrideReason)
    parsedConfig.overrideReason = config.overrideReason;
  if (config.version) parsedConfig.version = parseInt(config.version);
  if (config.lastModified)
    parsedConfig.lastModified = DateTime.fromISO(config.lastModified);

  if (!keys) return parsedConfig as DailyConfig;
  return parsedConfig as Pick<DailyConfig, Keys[number]>;
}

export async function setDailyConfig(
  redis: Redis,
  date: DateTime,
  config: Omit<
    DailyConfig,
    | 'lastModified'
    | 'version'
    | 'authorMap'
    | 'memoryBy'
    | 'variationBy'
    | 'overrideBy'
  >,
  authorId: string
) {
  const isoDate = date.toISODate();
  if (!isoDate) throw new Error('Invalid date');
  if (!config.memory && !config.variation && !config.override)
    throw new Error('No config to set');

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

  if (override !== undefined) {
    editedField.push('override', 'overrideReason');
    if (override) {
      if (!config.overrideReason) throw new Error('Missing override reason');
      configStringified.override = JSON.stringify(config.override);
      configStringified.overrideBy = authorId;
      configStringified.overrideReason = config.overrideReason;
    } else delField.push('override', 'overrideBy', 'overrideReason');
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

export async function getGlobalShardConfig(
  redis: Redis
): Promise<GlobalConfig | undefined> {
  const config = await redis.hgetall<Record<keyof GlobalConfig, string>>(
    'global'
  );
  if (!config) return undefined;
  if (config.bugged && config.bugged === 'true') {
    return { bugged: true, buggedReason: config.buggedReason };
  } else return undefined;
}

export async function setGlobalShardConfig(redis: Redis, data: GlobalConfig) {
  if (data.bugged) {
    if (!data.buggedReason)
      throw new Error('Missing reason for setting bugged state');
    await redis.hset('global', {
      bugged: true,
      buggedReason: data.buggedReason,
    });
  } else redis.del('global');

  await redis.sadd('edited_fields', 'global');
}

export async function pushAuthorName(
  redis: Redis,
  authorId: string,
  authorName: string
) {
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
  global: GlobalConfig;
}
