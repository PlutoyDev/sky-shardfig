import type { Redis } from '@upstash/redis';
import { DateTime, Duration } from 'luxon';

export const memories = ['Jellyfish', 'Crab', 'Manta', 'Krill', 'Whale', 'Elder'] as const;

export const commonOverrideReasons = {
  event_area: 'Events are occuring in the area',
  buggy_sky: 'Sky is buggy',
  schedule_change: 'Schedule has changed',
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

export interface DailyConfig extends Record<string, unknown> {
  memory?: number | null;
  memoryBy?: string | null;
  variation?: number | null;
  variationBy?: string | null;
  override?: Override | null;
  overrideBy?: string | null;
  overrideReason?: string | null;
}

export async function getParsedDailyConfig(redis: Redis, date: DateTime | string) {
  if (typeof date !== 'string') date = date.toISODate() as string;
  const hashKey = `daily:${date}`;

  const config = await redis.hgetall<DailyConfig>(hashKey);
  if (!config) return undefined;

  return config;
}

export async function setDailyConfig(
  redis: Redis,
  date: DateTime,
  config: Pick<DailyConfig, 'memory' | 'variation' | 'override' | 'overrideReason'>,
  authorId: string,
) {
  const isoDate = date.toISODate();
  if (!isoDate) throw new Error('Invalid date');
  const hashKey = `daily:${isoDate}`;

  const { memory, variation, override, overrideReason } = config;

  const configSet: DailyConfig = { ...config };

  const deletingField: string[] = [];

  if (memory === null) {
    deletingField.push('memory', 'memoryBy');
    delete config.memory;
  } else if (memory !== undefined) {
    configSet.memoryBy = authorId;
  }

  if (variation === null) {
    deletingField.push('variation', 'variationBy');
    delete config.variation;
  } else if (variation !== undefined) {
    configSet.variationBy = authorId;
  }

  if (override === null) {
    deletingField.push('override', 'overrideBy', 'overrideBy');
    delete config.override;
    delete config.overrideReason;
  } else if (overrideReason !== undefined) {
    configSet.overrideBy = authorId;
  }

  const editedConfigKeys = Object.keys(configSet);

  return Promise.all([
    editedConfigKeys.length > 1 ? redis.hset(hashKey, configSet) : Promise.resolve(),
    deletingField.length > 1 ? redis.hdel(hashKey, ...deletingField) : Promise.resolve(),
  ]);
}

export async function pushAuthorName(redis: Redis, authorId: string, authorName: string) {
  await redis.hset('author_names', { [authorId]: authorName });
}

export async function getAuthorNames(redis: Redis) {
  const authorNames = await redis.hgetall('author_names');
  if (!authorNames) return {};
  return authorNames as Record<string, string>;
}

export const warnings = {
  bugged: 'Shard is bugged',
  changed: 'This schedule of shard has changed',
  disabled: 'This shard has been disabled',
} as const;

type Warning = keyof typeof warnings;

export async function getWarning(redis: Redis) {
  const [warning, warningLink] = await redis.mget('warnings', 'warning_link') as [Warning | null, string];
  if (!warning || !warningLink) return null;
  return { warning, warningLink };
}

export async function setWarning(redis: Redis, warning: Warning | null, warningLink: string) {
  return redis.mset({ warnings: warning, warning_link: warningLink });
}

export async function clearWarning(redis: Redis) {
  return redis.del('warnings', 'warning_link');
}

export interface RemoteConfigResponse {
  dailiesMap: Record<string, DailyConfig>;
  authorNames: Record<string, string>;
  warning?: 'bugged' | 'changed' | 'disabled';
  warningLink?: string;
  // Randomly generated string for polling check
  id: string;
}

export async function getResponse(redis: Redis) {
  return redis.get<RemoteConfigResponse>('outCache');
}

export async function sendResponse(redis: Redis, res: string) {
  return redis.set('outCache', res);
}
