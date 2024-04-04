import { REST } from '@discordjs/rest';
import { Redis } from '@upstash/redis';
import axios from 'axios';
import {
  MessageFlags,
  RESTPatchAPIInteractionOriginalResponseJSONBody,
  RESTPostAPIWebhookWithTokenJSONBody,
  Routes,
} from 'discord-api-types/v10';
import { mkdir, writeFile } from 'fs/promises';
import { DateTime } from 'luxon';
import {
  RemoteConfigResponse,
  getParsedDailyConfig,
  DailyConfig,
  getGlobalShardConfig,
  getAuthorNames,
} from '../shared/lib.js';

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
  throw new Error(`Missing required environment variables: ${missingEnv.join(', ')}`);
}

type RequiredEnv = Record<(typeof envRequired)[number], string>;

declare global {
  namespace NodeJS {
    interface ProcessEnv extends RequiredEnv, Record<string, string> {}
  }
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const logs: string[] = [];
const log = (msg: string) => {
  logs.push(`[${DateTime.now().toISO()}] ${msg}`);
  console.log(msg);
};
const errorLog = (msg: string, err: unknown) => {
  logs.push(`\n\n[${DateTime.now().toISO()}] ${msg}\n${stringifyError(err)}`);
  console.error(msg, err);
};
const stringifyError = (err: unknown) =>
  err && typeof err === 'object' && 'message' in err ? err.message : JSON.stringify(err);

log('Starting publish script');

try {
  const dailiesMap: Record<string, DailyConfig> = {};

  // Fetch config for dates that have been edited
  const editedDates = await redis.smembers('edited_dates');
  if (editedDates.length) {
    log(`Fetched edited dates: ${editedDates.join(', ')}`);
    await Promise.all([
      redis.del('edited_dates'),
      ...editedDates.map(async dateStr => {
        const date = DateTime.fromISO(dateStr);
        const config = await getParsedDailyConfig(redis, date);
        if (config) {
          dailiesMap[dateStr] = config;
          log(`\tFetched ${dateStr} config`);
        } else {
          log(`\tFailed to fetch ${dateStr} config: empty or invalid`);
        }
      }),
    ]).catch(err => {
      console.error('Failed to fetch edited dates', stringifyError(err));
      log('Failed to fetch edited dates');
      log('Error: ' + stringifyError(err));
      throw err;
    });
  }

  // Fetch previous daily config
  if (process.env.DISABLE_PUBLISHED !== 'true') {
    log('Fetching previous daily config');
    await axios
      .get<RemoteConfigResponse>('https://sky-shardfig.plutoy.top/minified.json', {
        validateStatus: status => status === 200,
      })
      .then(async res => {
        const prevRemoteConfig = res.data;
        log('Fetched previous daily config: ' + Object.keys(prevRemoteConfig.dailiesMap));
        Object.assign(dailiesMap, prevRemoteConfig.dailiesMap);
      })
      .catch(err => {
        console.error('Failed to fetch previous daily config', stringifyError(err));
        log('Failed to fetch previous daily config');
        log('Error: ' + stringifyError(err));
      });
  } else {
    log('Fetching previous config are disabled');
  }
  log('Fetching global config and author names');
  const [global, authorNames] = await Promise.all([getGlobalShardConfig(redis), getAuthorNames(redis)]).catch(err => {
    console.error('Failed to fetch global config and/or author names', stringifyError(err));
    log('Failed to fetch global config and/or author names');
    log('Error: ' + stringifyError(err));
    throw err;
  });

  const remoteConfigOut: RemoteConfigResponse = {
    authorNames,
    dailiesMap,
  };
  if (global) {
    remoteConfigOut.global = global;
  }

  log('Writing to file');
  await mkdir('dist').catch(() => {});
  await Promise.all([
    writeFile('dist/prettified.json', JSON.stringify(remoteConfigOut, null, 2)),
    writeFile('dist/minified.json', JSON.stringify(remoteConfigOut)),
    writeFile('dist/last_updated.txt', Date.now().toString()),
  ]);

  log('Published config');

  //Respond to the interaction if it exists
  await redis.hgetall<Record<'id' | 'token', string>>('publish_callback').then(async publishInteraction => {
    if (publishInteraction?.id && publishInteraction?.token) {
      log('Responding to interaction');
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

      await rest.patch(Routes.webhookMessage(process.env.DISCORD_CLIENT_ID, publishInteraction.token, '@original'), {
        body: {
          content: 'Config has been published to Sky-Shards\nThank you for your contribution!',
        } satisfies RESTPatchAPIInteractionOriginalResponseJSONBody,
      });

      await redis.del('publish_callback');
      log('Responded to interaction');
    }
  });

  // Send the logs to the webhook
  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: 'Configuration published\n\n```' + logs.join('\n') + '```',
    flags: MessageFlags.SuppressNotifications,
  } satisfies RESTPostAPIWebhookWithTokenJSONBody);
} catch (err) {
  errorLog('Failed to publish config', err);
  // Send the logs to the webhook
  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: '<@702740689846272002>, Configuration publish failed\n\n```' + logs.join('\n') + '```',
    allowed_mentions: { users: ['702740689846272002'] },
  } satisfies RESTPostAPIWebhookWithTokenJSONBody);
}
