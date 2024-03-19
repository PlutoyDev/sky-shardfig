import { Redis } from '@upstash/redis/cloudflare';
import { REST } from '@discordjs/rest';
import type {
  APIInteraction,
  APIInteractionResponse,
} from 'discord-api-types/v10';
import {
  Routes,
  InteractionType,
  InteractionResponseType,
} from 'discord-api-types/v10';
import nacl from 'tweetnacl';

const memories = [
  'jellyfish',
  'crab',
  'manta',
  'krill',
  'whale',
  'elder',
] as const;

interface DailyShardConfig {
  memory?: (typeof memories)[number];
  variation?: string;
  isBugged?: boolean;
  bugType?: 'noShard' | 'noMemory';
  isDisabled?: boolean;
  disabledReason?: string;
  credits?: string[];
  lastModified?: string;
  lastModifiedBy?: string;
}

interface GlobalShardConfig {
  dailyMap: Record<string, DailyShardConfig>; //key = yyyy-mm-dd
  isBugged?: boolean;
  bugType?: 'inaccurate' | 'tgc :/';
  lastModified?: string;
  lastModifiedBy?: string;
}

interface RequiredEnv {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
}
// Environment variables are injected at build time, so cannot destructured, cannot access with []

// /discord endpoint
const discord: PagesFunction<RequiredEnv> = async context => {
  const request = context.request;
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) {
    return new Response('Unauthorized: Missing signature or timestamp', {
      status: 401,
    });
  }
  const body = await request.text();
  const isVerified = nacl.sign.detached.verify(
    Buffer.from(timestamp + body),
    Buffer.from(signature, 'hex'),
    Buffer.from(context.env.DISCORD_PUBLIC_KEY, 'hex')
  );

  if (!isVerified) {
    return new Response('Unauthorized: Invalid request signature', {
      status: 401,
    });
  }

  // Discord.js REST Client
  const rest = new REST({ version: '10' }).setToken(
    context.env.DISCORD_CLIENT_SECRET
  );

  // Handle Interaction
  const interaction = JSON.parse(body) as APIInteraction;

  // Ping Pong (Checked by Discord)
  if (interaction.type === InteractionType.Ping) {
    rest.post(Routes.interactionCallback(interaction.id, interaction.token), {
      body: {
        type: InteractionResponseType.Pong,
      } satisfies APIInteractionResponse,
    });
  }
};

export const onRequest: PagesFunction<RequiredEnv> = async context => {
  const request = context.request;
  const url = new URL(request.url);
  if (url.pathname === '/discord' && request.method === 'POST') {
    return discord(context);
  }
  return new Response('Not Found', { status: 404 });
};
