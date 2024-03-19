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

function valueToUint8Array(
  value: Uint8Array | ArrayBuffer | Buffer | string,
  format?: string
): Uint8Array {
  if (value == null) {
    return new Uint8Array();
  }
  if (typeof value === 'string') {
    if (format === 'hex') {
      const matches = value.match(/.{1,2}/g);
      if (matches == null) {
        throw new Error('Value is not a valid hex string');
      }
      const hexVal = matches.map((byte: string) => parseInt(byte, 16));
      return new Uint8Array(hexVal);
    } else {
      return new TextEncoder().encode(value);
    }
  }
  try {
    if (Buffer.isBuffer(value)) {
      return new Uint8Array(value);
    }
  } catch (ex) {
    // Runtime doesn't have Buffer
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  throw new Error(
    'Unrecognized value type, must be one of: string, Buffer, ArrayBuffer, Uint8Array'
  );
}

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
    valueToUint8Array(timestamp + body),
    valueToUint8Array(signature, 'hex'),
    valueToUint8Array(context.env.DISCORD_PUBLIC_KEY, 'hex')
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
    await rest.post(
      Routes.interactionCallback(interaction.id, interaction.token),
      {
        body: {
          type: InteractionResponseType.Pong,
        } satisfies APIInteractionResponse,
      }
    );
  }

  // Always return 200 OK
  return new Response('OK', { status: 200 });
};
