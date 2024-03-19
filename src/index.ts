import { Redis } from '@upstash/redis';
import type { GlobalShardConfig } from '../shared/types.js';
import { DateTime } from 'luxon';
import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import { getGlobalShardConfig, getDailyShardConfig } from '../shared/lib.js';

const envRequired = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'DISCORD_WEBHOOK_URL',
] as const;

const missingEnv = envRequired.filter(env => !process.env[env]);
if (missingEnv.length) {
  throw new Error(
    `Missing required environment variables: ${missingEnv.join(', ')}`
  );
}

type RequiredEnv = Record<(typeof envRequired)[number], string>;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends RequiredEnv {}
  }
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const globalShardConfig = await getGlobalShardConfig(redis);

try {
  // Fetch the previous config to skip reading previous days' config

  const prevConfigRes = await axios.get<GlobalShardConfig>(
    'https://sky-shardfig.plutoy.top/minified.json'
  );
  const prevConfig = prevConfigRes.data;
  console.log('Fetched previous config', Object.keys(prevConfig.dailyMap));
  Object.assign(globalShardConfig.dailyMap, prevConfig.dailyMap);
} catch (err) {
  console.error(
    'Failed to fetch previous config:',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}

const dailyTupleRes = await getDailyShardConfig(redis);
if (dailyTupleRes) {
  const [isoDate, todayConfig] = dailyTupleRes;
  globalShardConfig.dailyMap[isoDate] = todayConfig;
  console.log(`Fetched ${isoDate} config`);
}

console.log('Writing to file');

await mkdir('dist').catch(() => {});
await Promise.all([
  writeFile('dist/prettified.json', JSON.stringify(globalShardConfig, null, 2)),
  writeFile('dist/minified.json', JSON.stringify(globalShardConfig)),
]);

try {
  // Update Discord Embed
  const messageId = await redis.get('discordMessageId');
  const fields = [];
  if (globalShardConfig.isBugged) {
    fields.push({
      name: 'Is Bugged',
      value: 'Yes',
    });
    fields.push({
      name: 'Bug Type',
      value: globalShardConfig.bugType,
    });
  }
  fields.push({
    name: 'Last Modified',
    value: globalShardConfig.lastModified
      ? `${globalShardConfig.lastModified} by ${globalShardConfig.lastModifiedBy}`
      : 'Unknown',
  });

  if (dailyTupleRes) {
    Object.entries(dailyTupleRes[1]).forEach(([key, value], i) => {
      fields.push({
        name: `Today's ${key}`,
        value,
      });
    });
  }

  const embed = {
    title: `Shard Config`,
    fields,
    timestamp: DateTime.now().toISO(),
  };

  let updateSuccess = false;
  if (messageId !== null) {
    const res = await axios
      .patch(`${process.env.DISCORD_WEBHOOK_URL}/messages/${messageId}`, {
        embeds: [embed],
      })
      .catch(() =>
        axios.delete(`${process.env.DISCORD_WEBHOOK_URL}/messages/${messageId}`)
      )
      .catch(() => {});
    updateSuccess = res?.status === 200;
  }

  if (!updateSuccess) {
    const res = await axios.post(
      `${process.env.DISCORD_WEBHOOK_URL}?wait=true`,
      { embeds: [embed] }
    );
    await redis.set('discordMessageId', res.data.id);
  }
} catch (err) {
  console.error(
    'Failed to update Discord Embed',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}
