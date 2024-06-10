import { REST } from '@discordjs/rest';
import { Redis } from '@upstash/redis';
import axios from 'axios';
import {
  MessageFlags,
  RESTPatchAPIInteractionOriginalResponseJSONBody,
  RESTPostAPIWebhookWithTokenJSONBody,
  RESTPostAPIWebhookWithTokenResult,
  RESTPostAPIWebhookWithTokenWaitResult,
  Routes,
} from 'discord-api-types/v10';
import { mkdir, writeFile } from 'fs/promises';
import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';
import {
  RemoteConfigResponse,
  getParsedDailyConfig,
  DailyConfig,
  getAuthorNames,
  getWarning,
  getResponse,
  sendResponse,
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

mkdir('dist', { recursive: true });

try {
  // Send a webhook message to the Discord channel first
  const res = await axios.post<RESTPostAPIWebhookWithTokenWaitResult>(
    process.env.DISCORD_WEBHOOK_URL,
    {
      content: 'Publishing configuration...',
      flags: MessageFlags.SuppressNotifications,
    } satisfies RESTPostAPIWebhookWithTokenJSONBody,
    { params: { wait: true } },
  );

  const webhookMessageId = res.data.id;

  const last3Days = Array.from({ length: 3 }, (_, i) => DateTime.now().minus({ days: i }).toISODate());
  let fetchDates: string[];
  const purge = await redis.get('publish_purge');
  if (purge) {
    // Refetch all dates
    const keys = new Set<string>();
    let cursor = 0;
    log(`Scanning keys`);
    do {
      const [next, ks] = await redis.scan(cursor, { match: 'daily:*', count: 1000 });
      cursor = next;
      ks.forEach(k => keys.add(k));
    } while (cursor !== 0);

    log(`Scanned ${keys.size} keys`);
    fetchDates = [];
    for (const key of keys) {
      const date = key.substring(6);
      fetchDates.push(date);
    }

    redis.del('publish_purge');
  } else {
    fetchDates = last3Days;
  }

  log('Fetching redis data');
  const [dailies, prevResponse, authorNames, warningRes, callback] = await Promise.all([
    Promise.all(fetchDates.map(date => getParsedDailyConfig(redis, date))),
    !purge ? getResponse(redis) : null,
    getAuthorNames(redis),
    getWarning(redis),
    redis.hgetall<Record<'id' | 'token', string>>('publish_callback'),
  ]).catch(err => {
    errorLog('Failed to fetch redis data', err);
    throw err;
  });

  log('Creating response object');

  const dailiesMap: Record<string, DailyConfig> = {};
  fetchDates.forEach((date, i) => {
    const daily = dailies[i];
    if (daily) {
      dailiesMap[date] = daily;
    }
  });

  if (prevResponse) {
    log('Merging previous response');
    Object.assign(dailiesMap, prevResponse.dailiesMap);
  }

  const remoteConfigOut: RemoteConfigResponse = {
    authorNames,
    dailiesMap,
    id: nanoid(7),
  };

  // create a smaller version of the response with only the last 3 days
  const last3DaysMap: Record<string, DailyConfig> = {};
  last3Days.forEach(date => {
    const daily = dailiesMap[date];
    if (daily) {
      last3DaysMap[date] = daily;
    }
  });

  const last3DaysResponse: RemoteConfigResponse = {
    authorNames,
    dailiesMap: last3DaysMap,
    id: remoteConfigOut.id,
  };

  if (warningRes) {
    const { warning, warningLink } = warningRes;
    log('Setting warning');
    last3DaysResponse.warning = remoteConfigOut.warning = warning;
    last3DaysResponse.warningLink = remoteConfigOut.warningLink = warningLink;
  }

  log('Writing to file');
  const fullJson = JSON.stringify(remoteConfigOut);
  await Promise.all([
    writeFile('dist/all_pretty.json', JSON.stringify(remoteConfigOut, null, 2)),
    writeFile('dist/all.json', fullJson),
    writeFile('dist/minified.json', JSON.stringify(last3DaysResponse)),
    writeFile('dist/poll_id.txt', remoteConfigOut.id),
    sendResponse(redis, fullJson),
  ]);

  if (callback) {
    log('Responding to interaction');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    Promise.all([
      rest.patch(Routes.webhookMessage(process.env.DISCORD_CLIENT_ID, callback.token, '@original'), {
        body: {
          content: 'Config has been published to Sky-Shards\nThank you for your contribution!',
        } satisfies RESTPatchAPIInteractionOriginalResponseJSONBody,
      }),
      redis.del('publish_callback'),
    ]);
  }

  log('Published config');
  log('Config ID: ' + remoteConfigOut.id);

  // // Send the logs to the webhook
  // await axios.post(process.env.DISCORD_WEBHOOK_URL, {
  //   content: 'Configuration published\n\n```' + logs.join('\n') + '```',
  //   flags: MessageFlags.SuppressNotifications,
  // } satisfies RESTPostAPIWebhookWithTokenJSONBody);

  // Edit the webhook message to include the logs
  await axios.patch(process.env.DISCORD_WEBHOOK_URL + '/messages/' + webhookMessageId, {
    content: 'Configuration published\n\n```' + logs.join('\n') + '```',
  } satisfies RESTPatchAPIInteractionOriginalResponseJSONBody);
} catch (err) {
  errorLog('Failed to publish config', err);
  // Send the logs to the webhook
  await axios.post(process.env.DISCORD_WEBHOOK_URL, {
    content: '<@702740689846272002>, Configuration publish failed\n\n```' + logs.join('\n') + '```',
    allowed_mentions: { users: ['702740689846272002'] },
  } satisfies RESTPostAPIWebhookWithTokenJSONBody);

  const callback = await redis.hgetall<Record<'id' | 'token', string>>('publish_callback');
  if (callback) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.patch(Routes.webhookMessage(process.env.DISCORD_CLIENT_ID, callback.token, '@original'), {
      body: {
        content:
          '<:MothShocked:855634907867250749> Oops!!\n Failed to publish config\nPlutoy has been notified and will look into it.',
      } satisfies RESTPatchAPIInteractionOriginalResponseJSONBody,
    });
  }
}
