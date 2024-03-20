import { Redis } from '@upstash/redis/cloudflare';
import type {
  APIApplicationCommandInteractionDataBooleanOption,
  APIApplicationCommandInteractionDataNumberOption,
  APIApplicationCommandInteractionDataStringOption,
  APIEmbedField,
  APIInteraction,
  APIInteractionResponse,
} from 'discord-api-types/v10';
import {
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  ApplicationCommandType,
  Routes,
} from 'discord-api-types/v10';
import nacl from 'tweetnacl';
import { DateTime } from 'luxon';
import {
  GlobalShardConfig,
  memories,
  parseDailyShardConfigStringified,
  getDailyShardConfig,
} from '../shared/lib.js';
import { REST } from '@discordjs/rest';

interface RequiredEnv {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  CLOUDFLARE_DEPLOY_URL: string;
}
// Environment variables are injected at build time, so cannot destructured, cannot access with []

function valueToUint8Array(
  value: Uint8Array | ArrayBuffer | string,
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

function InteractionResponse(response: APIInteractionResponse): Response {
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
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

  // Handle Interaction
  const interaction = JSON.parse(body) as APIInteraction;

  // Ping Pong (Checked by Discord)
  if (interaction.type === InteractionType.Ping) {
    return InteractionResponse({ type: InteractionResponseType.Pong });
  }

  const { guild_id, channel, member } = interaction;

  if (!guild_id || !member || guild_id !== '1219255956207046727') {
    return InteractionResponse({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'This bot is not allowed in this server',
        flags: MessageFlags.Ephemeral,
      },
    });
  }

  if (channel.id !== '1219629213238296676') {
    return InteractionResponse({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: 'This command is not allowed in this channel',
        flags: MessageFlags.Ephemeral,
      },
    });
  }

  const discordRest = new REST({ version: '10' }).setToken(
    context.env.DISCORD_BOT_TOKEN
  );

  const redis = new Redis({
    url: context.env.UPSTASH_REDIS_REST_URL,
    token: context.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const resovledName = member.nick ?? member.user.global_name;

  // Handle Command
  if (interaction.type === InteractionType.ApplicationCommand) {
    if (interaction.data.type === ApplicationCommandType.ChatInput) {
      // Slash Command
      const { name, options } = interaction.data;
      const optionsMap = new Map(options?.map(option => [option.name, option]));

      const publishReminder =
        'Remember to </publish:1219872570669531247> the changes';

      let date = DateTime.now().setZone('America/Los_Angeles');
      const dateInput = optionsMap.get('date') as
        | APIApplicationCommandInteractionDataStringOption
        | undefined;

      if (dateInput) {
        // Verify Date
        const dateIn = DateTime.fromISO(dateInput.value);
        if (!dateIn.isValid) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'Invalid date' },
          });
        }

        // Cannot be 3 day in the past
        if (
          dateIn < DateTime.now().minus({ days: 3 }) &&
          member.user.id !== '702740689846272002'
        ) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                'Only <@702740689846272002> can set memory for dates older than 3 days',
              allowed_mentions: { users: ['702740689846272002'] },
            },
          });
        }

        date = dateIn;
      }
      const isoDate = date.toISODate();

      // Set Daily Memory
      if (name === 'set_memory') {
        const memory = optionsMap.get(
          'memory'
        ) as APIApplicationCommandInteractionDataStringOption;
        if (!memory || !memories.includes(memory.value as any)) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'Invalid memory option' },
          });
        }
        const memoryValue = memories.indexOf(memory.value as any);
        const { memory: prevMem, lastModifiedBy } =
          (await redis.hmget(`daily:${isoDate}`, 'memory', 'lastModifiedBy')) ??
          {};
        const newLastModifiedBy = lastModifiedBy
          ? (lastModifiedBy as string).includes(resovledName)
            ? lastModifiedBy
            : `${lastModifiedBy}, ${resovledName}`
          : resovledName;

        await redis.hset(`daily:${isoDate}`, {
          memory: memoryValue,
          lastModified: DateTime.now(),
          lastModifiedBy: newLastModifiedBy,
        });

        let prevMemIndex = prevMem ? parseInt(prevMem as string) : NaN;
        let prevMemStr = isNaN(prevMemIndex) ? 'unset' : memories[prevMemIndex];

        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content:
              `Memory for ${isoDate} has been changed from ` +
              `${prevMemStr} to \`${memory.value}\`` +
              publishReminder,
          },
        });
      }

      // Set Daily Variation
      if (name === 'set_variation') {
        const variation = optionsMap.get(
          'variation'
        ) as APIApplicationCommandInteractionDataNumberOption;
        if (!variation) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: 'Invalid variation option',
            },
          });
        }
        const variationValue = variation.value;

        const { variation: prevVar, lastModifiedBy } =
          (await redis.hmget(
            `daily:${isoDate}`,
            'variation',
            'lastModifiedBy'
          )) ?? {};

        const newLastModifiedBy = lastModifiedBy
          ? (lastModifiedBy as string).includes(resovledName)
            ? lastModifiedBy
            : `${lastModifiedBy}, ${resovledName}`
          : resovledName;

        await redis.hset(`daily:${isoDate}`, {
          variation: variationValue,
          lastModified: DateTime.now(),
          lastModifiedBy: newLastModifiedBy,
        });

        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content:
              `Variation for ${isoDate} has been changed from ` +
              `${prevVar ?? '`unset`'} to \`${variationValue}\`` +
              publishReminder,
          },
        });
      }

      // Set Daily Is Bugged
      if (name === 'set_bugged_status') {
        const isBugged = optionsMap.get(
          'is_bugged'
        ) as APIApplicationCommandInteractionDataBooleanOption;
        const bugType = optionsMap.get(
          'bug_type'
        ) as APIApplicationCommandInteractionDataStringOption;

        if (!isBugged) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'is_bugged option is required' },
          });
        }

        if (isBugged.value) {
          if (!bugType) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'bug_type option is required' },
            });
          }
          if (!['noShard', 'noMemory'].includes(bugType.value)) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'bug_type is required' },
            });
          }

          const {
            isBugged: prevIsBugged,
            bugType: prevBugType,
            lastModifiedBy,
          } = (await redis.hmget(
            `daily:${isoDate}`,
            'isBugged',
            'bugType',
            'lastModifiedBy'
          )) ?? {};

          const newLastModifiedBy = lastModifiedBy
            ? (lastModifiedBy as string).includes(resovledName)
              ? lastModifiedBy
              : `${lastModifiedBy}, ${resovledName}`
            : resovledName;

          await redis.hset(`daily:${isoDate}`, {
            isBugged: true,
            bugType: bugType.value,
            lastModified: DateTime.now(),
            lastModifiedBy: newLastModifiedBy,
          });

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                `Shard for ${isoDate} has been set as bugged (${bugType.value})` +
                (prevIsBugged ? ` from ${prevBugType}` : ' from `unset`') +
                publishReminder,
            },
          });
        } else {
          await redis.hdel(`daily:${isoDate}`, 'isBugged', 'bugType');

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                `Shard for ${isoDate} has been set as not bugged` +
                publishReminder,
            },
          });
        }
      }

      // Set Daily Is Disabled
      if (name === 'set_disabled_status') {
        const isDisabled = optionsMap.get(
          'is_disabled'
        ) as APIApplicationCommandInteractionDataBooleanOption;
        const disabledReason = optionsMap.get(
          'disabled_reason'
        ) as APIApplicationCommandInteractionDataStringOption;

        if (!isDisabled) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'is_disabled option is required' },
          });
        }

        if (isDisabled.value) {
          if (!disabledReason) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'disabled_reason is required' },
            });
          }

          const { isDisabled: prevIsDisabled, lastModifiedBy } =
            (await redis.hmget(
              `daily:${isoDate}`,
              'isDisabled',
              'lastModifiedBy'
            )) ?? {};

          const newLastModifiedBy = lastModifiedBy
            ? (lastModifiedBy as string).includes(resovledName)
              ? lastModifiedBy
              : `${lastModifiedBy}, ${resovledName}`
            : resovledName;

          await redis.hset(`daily:${isoDate}`, {
            isDisabled: true,
            disabledReason: disabledReason.value,
            lastModified: DateTime.now(),
            lastModifiedBy: newLastModifiedBy,
          });

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                `Shard for ${isoDate} has been set as disabled (${disabledReason.value})` +
                (prevIsDisabled ? ` from ${prevIsDisabled}` : ' from `unset`') +
                publishReminder,
            },
          });
        } else {
          await redis.hdel(`daily:${isoDate}`, 'isDisabled', 'disabledReason');

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                `Shard for ${isoDate} has been set as not disabled` +
                publishReminder,
            },
          });
        }
      }

      // Publish
      if (name === 'publish') {
        discordRest.post(
          Routes.interactionCallback(interaction.id, interaction.token),
          {
            body: InteractionResponse({
              type: InteractionResponseType.DeferredMessageUpdate,
            }),
          }
        );
        const publishedDataRes = await fetch(
          'https://sky-shardfig.plutoy.top/minified.json'
        );
        const publishedData =
          ((await publishedDataRes.json()) as GlobalShardConfig).dailyMap[
            isoDate
          ] ?? {};
        const unpublishData = (await getDailyShardConfig(redis))?.[1] ?? {};
        const fields: APIEmbedField[] = [];

        // Compare published data with current data
        if (publishedData.memory !== unpublishData.memory) {
          fields.push({
            name: 'Memory',
            value: `\`${unpublishData.memory}\` -> \`${publishedData.memory}\``,
          });
        }

        if (publishedData.variation !== unpublishData.variation) {
          fields.push({
            name: 'Variation',
            value: `\`${unpublishData.variation}\` -> \`${publishedData.variation}\``,
          });
        }

        if (publishedData.isBugged !== unpublishData.isBugged) {
          fields.push({
            name: 'Is Bugged',
            value: `\`${unpublishData.isBugged}\` -> \`${publishedData.isBugged}\``,
          });
        }

        if (publishedData.bugType !== unpublishData.bugType) {
          fields.push({
            name: 'Bug Type',
            value: `\`${unpublishData.bugType}\` -> \`${publishedData.bugType}\``,
          });
        }

        if (publishedData.isDisabled !== unpublishData.isDisabled) {
          fields.push({
            name: 'Is Disabled',
            value: `\`${unpublishData.isDisabled}\` -> \`${publishedData.isDisabled}\``,
          });
        }

        if (publishedData.disabledReason !== unpublishData.disabledReason) {
          fields.push({
            name: 'Disabled Reason',
            value: `\`${unpublishData.disabledReason}\` -> \`${publishedData.disabledReason}\``,
          });
        }

        if (fields.length === 0) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: 'No changes to publish',
            },
          });
        }

        const prevConfirmingUser = await redis.set(
          'publish_confirmation_user',
          member.user.id,
          { get: true }
        );

        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            embeds: [
              {
                title: `Confirm Publish for ${isoDate}`,
                description:
                  `Please confirm the following changes for ${isoDate}` +
                  (prevConfirmingUser
                    ? `\nRequest by <@${prevConfirmingUser}> has been replaced`
                    : ''),
                fields,
              },
            ],
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 1,
                    label: 'Confirm',
                    custom_id: 'publish_confirm',
                  },
                  {
                    type: 2,
                    style: 4,
                    label: 'Cancel',
                    custom_id: 'publish_cancel',
                  },
                ],
              },
            ],
          },
        });
      }
    }
  } else if (interaction.type === InteractionType.MessageComponent) {
    const { custom_id } = interaction.data;
    if (custom_id.startsWith('publish_')) {
      if (custom_id === 'publish_confirm') {
        const confirmingUser = await redis.get('publish_confirmation_user');
        if (confirmingUser !== member.user.id) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                'This publish request has to be confirmed by the original requester',
            },
          });
        }

        await redis.del('publish_confirmation_user');
        await redis.hmset('publish_callback', {
          id: interaction.id,
          token: interaction.token,
        });

        try {
          await fetch(context.env.CLOUDFLARE_DEPLOY_URL, {
            method: 'POST',
          });

          return InteractionResponse({
            type: InteractionResponseType.UpdateMessage,
            data: { content: 'Publishing...', embeds: [], components: [] },
          });
        } catch (e) {
          return InteractionResponse({
            type: InteractionResponseType.UpdateMessage,
            data: {
              content: 'Failed to publish: Deply hook failed',
              embeds: [],
              components: [],
            },
          });
        }
      } else if (custom_id === 'publish_cancel') {
        await redis.del('publish_confirmation_user');
        return InteractionResponse({
          type: InteractionResponseType.UpdateMessage,
          data: {
            content: 'Publish request has been cancelled',
            embeds: [],
            components: [],
          },
        });
      }
    }
  }

  // Always return 200 OK
  return new Response('OK', { status: 200 });
};
