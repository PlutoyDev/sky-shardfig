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
import { GlobalShardConfig } from '../shared/types';

interface RequiredEnv {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
}
// Environment variables are injected at build time, so cannot destructured, cannot access with []

export const onRequestPost: PagesFunction<RequiredEnv> = async context => {
  // Request Validation (Check if request is from Discord)
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

  // const redis = new Redis({
  //   url: context.env.UPSTASH_REDIS_REST_URL,
  //   token: context.env.UPSTASH_REDIS_REST_TOKEN,
  // });
};
