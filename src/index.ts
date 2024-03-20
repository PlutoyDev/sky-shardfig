import { Redis } from '@upstash/redis';
import { memories, type GlobalShardConfig } from '../shared/types.js';
import { DateTime } from 'luxon';
import axios from 'axios';
import { mkdir, writeFile } from 'fs/promises';
import { getGlobalShardConfig, getDailyShardConfig } from '../shared/lib.js';
import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import {
  RESTPatchAPIInteractionOriginalResponseJSONBody,
  Routes,
} from 'discord-api-types/v10';

const envRequired = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'DISCORD_WEBHOOK_URL',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_BOT_TOKEN',
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
      fields.push({ name: `Today's ${key}`, value, inline: true });
    });
  }

  const embed = {
    title: `Shard Config`,
    fields,
    timestamp: DateTime.now().toISO(),
  };

  await axios.post(`${process.env.DISCORD_WEBHOOK_URL}`, {
    embeds: [embed],
  });
} catch (err) {
  console.error(
    'Failed to update Discord Embed',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}

try {
  // Update interaction if it exists
  const publishInteraction = await redis.hgetall<
    Record<'id' | 'token', string>
  >('publish_callback');
  if (publishInteraction) {
    const rest = new REST({ version: '10' }).setToken(
      process.env.DISCORD_BOT_TOKEN
    );

    (await rest.patch(
      Routes.webhookMessage(
        process.env.DISCORD_CLIENT_ID,
        publishInteraction.token,
        '@original'
      ),
      {
        body: {
          content:
            'Published the config to Sky-Shards\nThank you for your contribution!',
        } satisfies RESTPatchAPIInteractionOriginalResponseJSONBody,
      }
    )) as RESTPatchAPIInteractionOriginalResponseJSONBody;

    await redis.del('publish_callback');
  }
} catch (err) {
  console.error(
    'Failed to update Discord Interaction',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}
