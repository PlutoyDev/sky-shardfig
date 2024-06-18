import { ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Client as QStashCient } from '@upstash/qstash';
import { Redis } from '@upstash/redis/cloudflare';
import {
  APIApplicationCommandInteractionDataBooleanOption,
  APIApplicationCommandInteractionDataNumberOption,
  APIApplicationCommandInteractionDataStringOption,
  APIEmbedField,
  APIInteraction,
  APIInteractionResponse,
  APIInteractionResponseCallbackData,
  ButtonStyle,
  ComponentType,
  RESTPatchAPIWebhookWithTokenMessageJSONBody,
  RouteBases,
  InteractionType,
  InteractionResponseType,
  MessageFlags,
  ApplicationCommandType,
  Routes,
  APIBaseComponent,
  APIMessageComponent,
  APIActionRowComponent,
  APIMessageActionRowComponent,
  RESTPostAPIWebhookWithTokenJSONBody,
} from 'discord-api-types/v10';
import { DateTime } from 'luxon';
import nacl from 'tweetnacl';
import {
  getParsedDailyConfig,
  memories,
  commonOverrideReasons,
  pushAuthorName,
  setDailyConfig,
  getShardInfo,
  Override,
  ShardInfo,
  shardsInfo,
  stringsEn,
  realms,
  numMapVarients,
  setWarning,
  warnings,
  clearWarning,
  RemoteConfigResponse,
} from '../shared/lib.js';

interface Env {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  UPSTASH_QSTASH_TOKEN: string;
  DISCORD_WEBHOOK_URL: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  CLOUDFLARE_DEPLOY_URL: string;
  DISABLE_PUBLISHED: string | undefined;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  DISCORD_REMINDER_WEBHOOK_URL: string;
}
// Environment variables are injected at build time, so cannot destructured, cannot access with []

function valueToUint8Array(value: Uint8Array | ArrayBuffer | string, format?: string): Uint8Array {
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
  throw new Error('Unrecognized value type, must be one of: string, Buffer, ArrayBuffer, Uint8Array');
}

function formatField(fieldName: string, value: any) {
  if (value === undefined || value === null) {
    return '`undefined`';
  } else if (fieldName === 'memory') {
    return '`' + memories[value as number] + '`';
  } else if (fieldName === 'variation') {
    return '`Variation ' + ((value as number) + 1) + '`';
  } else if (fieldName === 'overrideReason') {
    const v = value as string;
    if (v.startsWith('!!!')) {
      return '`' + v.slice(3) + '`';
    } else if (v in commonOverrideReasons) {
      return commonOverrideReasons[v as keyof typeof commonOverrideReasons];
    } else {
      return '`Unknown Reason Key: ' + v + '`';
    }
  } else if (typeof value === 'number') {
    return value.toString();
  } else if (typeof value === 'object') {
    return '`' + JSON.stringify(value) + '`';
  }
}

function InteractionResponse(response: APIInteractionResponse): Response {
  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function InteractionCallback(
  restClient: REST,
  interaction: Pick<APIInteraction, 'id' | 'token'>,
  response: APIInteractionResponse,
): Promise<unknown> {
  return restClient.post(Routes.interactionCallback(interaction.id, interaction.token), { body: response });
}

function encodeOverrideCustomId(date: DateTime, override?: Override, custom?: string): string {
  // Encode each property of the override into a string, null/undefined => -, boolean => 0/1, number => number, string => string
  if (!override) override = {};
  const keys = ['hasShard', 'isRed', 'group', 'realm', 'map'] as const;
  let customId = 'override_' + date.toFormat('yyMMdd') + '_';
  for (const key of keys) {
    const val = override[key];
    if (val === undefined || val === null) customId += '-';
    else if (key === 'hasShard' || key === 'isRed') customId += val ? '1' : '0';
    else if (key === 'group' || key === 'realm') customId += val.toString();
    else if (key === 'map') {
      // shortern map name
      const [r, a] = (val as string).split('.');
      customId += r[0] + a[0] + a[1];
    }
  }
  return custom ? customId + '_' + custom : customId;
}

function decodeOverrideCustomId(customId: string): {
  date: DateTime;
  override: Override;
  custom?: string;
} {
  // Decode each property of the override from a string, - => null, 0/1 => boolean, number => number, string => string
  const keys = ['hasShard', 'isRed', 'group', 'realm', 'map'] as const;
  const override: Override = {};
  const [, dateStr, dataStr, ...custom] = customId.split('_');
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = dataStr[i];
    if (val === '-') continue;
    else if (key === 'hasShard' || key === 'isRed') override[key] = val === '1';
    else if (key === 'group' || key === 'realm') override[key] = parseInt(val);
    else if (key === 'map') {
      // restore map name
      const val = dataStr.slice(i);
      override.map = Object.keys(stringsEn.skyMaps).find(k => RegExp(`^${val[0]}\\w*\\.${val.slice(1, 3)}`).test(k));
    }
  }
  return {
    date: DateTime.fromFormat(dateStr, 'yyMMdd', { zone: 'America/Los_Angeles' }),
    override,
    custom: custom.length > 0 ? custom.join('_') : undefined,
  };
}

function formatGroup(group: number): string {
  const { noShardWkDay, offset } = shardsInfo[group];
  return `${group < 2 ? 'Black' : 'Red'}, First:${offset.hours}:${offset.minutes.toString().padStart(2, '0')}, NA:${noShardWkDay
    .map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d % 7])
    .join('&')}`;
}

function generateShardInfoEmbedFields(info: ShardInfo): APIEmbedField[] {
  return [
    { name: 'Shard?', value: info.hasShard ? 'Yes' : 'No', inline: true },
    { name: 'Color', value: info.isRed ? 'Red' : 'Black', inline: true },
    { name: 'Group', value: formatGroup(info.group), inline: true },
    { name: 'Realm', value: stringsEn.skyRealms[realms[info.realm]], inline: true },
    { name: 'Map', value: stringsEn.skyMaps[info.map as keyof typeof stringsEn.skyMaps], inline: true },
    {
      name: 'Occurrences',
      value: info.occurrences
        .map(({ land, end }) => `${land.toFormat("'<t:'X':t>'")} - ${end.toFormat("'<t:'X':t>'")}`)
        .join('\n'),
    },
  ];
}

function generateOverwriteMenu(
  date: DateTime,
  currentOverride?: Override,
  final?: boolean,
): APIInteractionResponseCallbackData {
  const info = getShardInfo(date);

  const embeds = [
    new EmbedBuilder()
      .setTitle('Default calculated values')
      .setColor(0x8a76b1)
      .addFields(generateShardInfoEmbedFields(info))
      .toJSON(),
  ];

  const overwrittenInfo = getShardInfo(date, currentOverride);
  embeds.push(
    new EmbedBuilder()
      .setTitle('Overwritten values (if any)')
      .setColor(0x8a76b1)
      .addFields(generateShardInfoEmbedFields(overwrittenInfo))
      .toJSON(),
  );

  if (!final) {
    embeds.push(new EmbedBuilder().setTitle('Override Menu').setDescription('Pick your poison').toJSON());
    return {
      content: 'Override menu for ' + date.toISODate(),
      embeds,
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            new StringSelectMenuBuilder()
              .setCustomId(encodeOverrideCustomId(date, currentOverride, 'select_group'))
              .setPlaceholder('Select a group')
              .addOptions(
                Array.from({ length: 5 }, (_, i) => ({
                  default: i === overwrittenInfo.group,
                  label: formatGroup(i),
                  value: i.toString(),
                })),
              )
              .toJSON(),
          ],
        },
        {
          type: ComponentType.ActionRow,
          components: [
            new ButtonBuilder()
              .setCustomId(encodeOverrideCustomId(date, { ...currentOverride, hasShard: !overwrittenInfo.hasShard }))
              .setLabel('Toggle Shard')
              .setStyle(ButtonStyle.Primary)
              .toJSON(),
            new ButtonBuilder()
              .setCustomId(encodeOverrideCustomId(date, { ...currentOverride, isRed: !overwrittenInfo.isRed }))
              .setLabel('Toggle Color')
              .setStyle(ButtonStyle.Primary)
              .toJSON(),
          ],
        },
        {
          type: ComponentType.ActionRow,
          components: [
            new StringSelectMenuBuilder()
              .setCustomId(encodeOverrideCustomId(date, currentOverride, 'select_realm'))
              .setPlaceholder('Select a realm')
              .addOptions(
                realms.map((r, i) => ({
                  default: i === overwrittenInfo.realm,
                  label: stringsEn.skyRealms[r],
                  value: i.toString(),
                })),
              )
              .toJSON(),
          ],
        },
        {
          type: ComponentType.ActionRow,
          components: [
            new StringSelectMenuBuilder()
              .setCustomId(encodeOverrideCustomId(date, currentOverride, 'select_map'))
              .setPlaceholder('Select a map')
              .addOptions(
                Object.entries(stringsEn.skyMaps).map(([v, l]) => ({
                  default: v === overwrittenInfo.map,
                  label: l,
                  value: v,
                })),
              )
              .toJSON(),
          ],
        },
        {
          type: ComponentType.ActionRow,
          components: [
            new ButtonBuilder()
              .setCustomId(encodeOverrideCustomId(date, currentOverride, 'cancel'))
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Danger)
              .toJSON(),
            new ButtonBuilder()
              .setCustomId(encodeOverrideCustomId(date, currentOverride, 'confirm'))
              .setLabel('Confirm')
              .setStyle(ButtonStyle.Success)
              .toJSON(),
            new ButtonBuilder()
              .setCustomId(encodeOverrideCustomId(date, {}))
              .setLabel('Reset')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(currentOverride && Object.keys(currentOverride).length === 0)
              .toJSON(),
          ],
        },
      ],
    };
  }

  return {
    content: 'Finalized override for ' + date.toISODate(),
    embeds,
  };
}

export const onRequestPost: PagesFunction<Env> = async context => {
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
    valueToUint8Array(context.env.DISCORD_PUBLIC_KEY, 'hex'),
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

  const discordRest = new REST({ version: '10' }).setToken(context.env.DISCORD_BOT_TOKEN);

  const redis = new Redis({
    url: context.env.UPSTASH_REDIS_REST_URL,
    token: context.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const qstash = new QStashCient({ token: context.env.UPSTASH_QSTASH_TOKEN });

  const resovledName = member.nick ?? member.user.global_name ?? member.user.username;
  const isPlutoy = member.user.id === '702740689846272002';
  const isSuperUser = ['702740689846272002'].includes(member.user.id);

  // Handle Command
  if (interaction.type === InteractionType.ApplicationCommand) {
    if (interaction.data.type === ApplicationCommandType.ChatInput) {
      // Slash Command
      const { name, options } = interaction.data;
      const optionsMap = new Map(options?.map(option => [option.name, option]));
      console.log('Slash Command: ' + name, optionsMap);

      if (channel?.id === '1219629213238296676') {
        // Publish Command
        if (name === 'publish') {
          const rescanFlag = (optionsMap.get('rescan') as APIApplicationCommandInteractionDataBooleanOption | undefined)
            ?.value;

          if (rescanFlag && !isSuperUser) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: {
                content: 'Only specified user publish with rescan\nRetry without setting `rescan`',
                flags: MessageFlags.SuppressNotifications,
              },
            });
          }

          const [prevConfirmingUser] = await Promise.all([
            redis.set('publish_confirmation_user', member.user.id, { get: true, ex: 600 }),
            redis.get<string | null>('qstash_message_id').then(id => (id ? qstash.messages.delete(id) : undefined)),
            qstash
              .publishJSON({
                url:
                  RouteBases.api + Routes.webhookMessage(context.env.DISCORD_CLIENT_ID, interaction.token, '@original'),
                method: 'PATCH',
                delay: 600,
                body: {
                  content: `<@${member.user.id}> Publish request has expired`,
                  components: [],
                  allowed_mentions: { users: [member.user.id] },
                } satisfies RESTPatchAPIWebhookWithTokenMessageJSONBody,
              })
              .then(({ messageId }) => redis.set('qstash_message_id', messageId, { ex: 600 })), // Set qstash message id, so that it can be deleted later
          ]);

          let content = '';

          if (prevConfirmingUser) {
            content += `Previous publish request by <@${prevConfirmingUser}> has been cancelled\n\n`;
          }

          if (rescanFlag) {
            content += 'Rescan request by <@' + member.user.id + '>\n\n';
            if (!isPlutoy) {
              content += '<@702740689846272002> Rescan triggered notification,\n\n';
            }
            content += 'Are you sure you want to rescan and publish the new configurations?';

            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: {
                content,
                allowed_mentions: { users: ['702740689846272002'] },
                components: [
                  {
                    type: ComponentType.ActionRow,
                    components: [
                      new ButtonBuilder()
                        .setCustomId('publish_with_rescan_confirm')
                        .setLabel('Confirm')
                        .setStyle(ButtonStyle.Success)
                        .toJSON(),
                      new ButtonBuilder()
                        .setCustomId('publish_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Danger)
                        .toJSON(),
                    ],
                  },
                ],
              },
            });
          }

          const last3IsoDates = Array.from({ length: 3 }, (_, i) => DateTime.now().minus({ days: i }).toISODate());
          const [dailyConfigs, prevConfig] = await Promise.all([
            Promise.all(last3IsoDates.map(date => getParsedDailyConfig(redis, date))),
            redis.get<RemoteConfigResponse>('outCache'),
          ]);

          if (dailyConfigs.every(c => !c)) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'No configurations to publish' },
            });
          }

          content += 'The following are the current configurations:\n\n';

          for (let i = 0; i < 3; i++) {
            const c = dailyConfigs[i];
            if (!c) continue;
            content += `For **${last3IsoDates[i]}**\n`;
            // Check for changes
            const prevC = prevConfig?.dailiesMap[last3IsoDates[i]];
            if (c.memory !== undefined) {
              content += 'Memory: ';
              if (prevC && prevC.memory !== undefined && c.memory !== prevC.memory) {
                content += formatField('memory', prevC.memory) + ' -> ';
              }
              content += formatField('memory', c.memory) + '\n';
            }
            if (c.variation !== undefined) {
              content += 'Variation: ';
              if (prevC && prevC.variation !== undefined && c.variation !== prevC.variation) {
                content += formatField('variation', prevC.variation) + ' -> ';
              }
              content += formatField('variation', c.variation) + '\n';
            }
            if (c.overrideReason !== undefined) {
              content += 'Override Reason: ';
              if (prevC && prevC.overrideReason !== undefined && c.overrideReason !== prevC.overrideReason) {
                content += formatField('overrideReason', prevC.overrideReason) + ' -> ';
              }
              content += formatField('overrideReason', c.overrideReason) + '\n';
            }
            if (c.override !== undefined) {
              content += 'Override: ';
              if (prevC && prevC.override !== undefined && c.override !== prevC.override) {
                content += formatField('override', prevC.override) + ' -> ';
              }
              content += formatField('override', c.override) + '\n';
            }

            content += '\n';
          }

          content += '\nDo you want to publish these configurations?';

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content,
              allowed_mentions: prevConfirmingUser ? { users: [prevConfirmingUser] } : undefined,
              components: [
                {
                  type: ComponentType.ActionRow,
                  components: [
                    new ButtonBuilder()
                      .setCustomId('publish_confirm')
                      .setLabel('Confirm')
                      .setStyle(ButtonStyle.Success)
                      .toJSON(),
                    new ButtonBuilder()
                      .setCustomId('publish_cancel')
                      .setLabel('Cancel')
                      .setStyle(ButtonStyle.Danger)
                      .toJSON(),
                  ],
                },
              ],
            },
          });
        }

        if (name === 'set_daily') {
          let date = DateTime.now().setZone('America/Los_Angeles').startOf('day');
          const dateInput = optionsMap.get('date') as APIApplicationCommandInteractionDataStringOption | undefined;

          if (dateInput) {
            // Verify Date
            let dateIn = DateTime.fromISO(dateInput.value, { zone: 'America/Los_Angeles' });
            if (!dateIn.isValid) {
              // Check if the date is relative
              const relative = parseInt(dateInput.value);
              if (!isNaN(relative)) {
                dateIn = date.plus({ days: relative });
              } else {
                return InteractionResponse({
                  type: InteractionResponseType.ChannelMessageWithSource,
                  data: { content: 'Invalid date' },
                });
              }
            }

            // Cannot be 3 day in the past
            if (dateIn < DateTime.now().minus({ days: 3 }) && !isSuperUser) {
              return InteractionResponse({
                type: InteractionResponseType.ChannelMessageWithSource,
                data: {
                  content: 'Only specified user can configure for dates older than 3 days',
                  flags: MessageFlags.SuppressNotifications,
                },
              });
            }
            date = dateIn;
          }

          if (optionsMap.size <= (dateInput ? 1 : 0)) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'Nothing to set' },
            });
          }

          // TODO: Fetch Overrides and pass it to getShardInfo
          const shardInfo = getShardInfo(date);
          const edits: Parameters<typeof setDailyConfig>[2] = {};
          let editStr = `For ${date.toISODate()}\n\n`;
          const components: APIActionRowComponent<APIMessageActionRowComponent>[] = [];

          if (optionsMap.has('memory')) {
            const memOpt = optionsMap.get('memory') as APIApplicationCommandInteractionDataNumberOption;
            if (!shardInfo.hasShard) {
              editStr += 'Memories can only be set on days with shards\n';
            } else if (!shardInfo.isRed) {
              editStr += 'Memories can only be set on Red days\n';
            } else if (memOpt.value === -1) {
              edits.memory = null;
              editStr += 'Memory removed\n';
            } else {
              edits.memory = memOpt.value;
              editStr += 'Memory set as `' + formatField('memory', memOpt.value) + '`\n';
            }
          }

          if (optionsMap.has('variation')) {
            const variOpt = optionsMap.get('variation') as APIApplicationCommandInteractionDataNumberOption;
            if (!shardInfo.hasShard) {
              editStr += 'Variations can only be set on days with shards\n';
            } else {
              const maxVariants = numMapVarients[shardInfo.map as keyof typeof numMapVarients];
              if (!maxVariants) {
                editStr += `There is only 1 variant for ${stringsEn.skyMaps[shardInfo.map as keyof typeof stringsEn.skyMaps]}, no need to set\n`;
              } else if (variOpt.value >= maxVariants) {
                editStr += `There is only ${maxVariants} variants for ${stringsEn.skyMaps[shardInfo.map as keyof typeof stringsEn.skyMaps]}\n`;
              } else if (variOpt.value === -1) {
                edits.variation = null;
                editStr += 'Variation removed\n';
              } else if (variOpt.value === -2) {
                components.push({
                  type: ComponentType.ActionRow,
                  components: [
                    new StringSelectMenuBuilder()
                      .setCustomId(`variation_${date.toISODate()}`)
                      .setPlaceholder('Select a variation')
                      .addOptions(
                        Array.from({ length: maxVariants }, (_, i) => {
                          const tag = `${shardInfo.map}.${i}` as keyof typeof stringsEn.skyMapVariants;
                          return {
                            label: stringsEn.skyMapVariants[tag],
                            value: i.toString(),
                          };
                        }),
                      )
                      .toJSON(),
                  ],
                });
              } else {
                edits.variation = variOpt.value;
                const varientTag = `${shardInfo.map}.${variOpt.value}` as keyof typeof stringsEn.skyMapVariants;
                const previewInfographic = `https://v8.sky-shards.pages.dev/infographics/map_varient_clement/${varientTag}.webp`;
                const varientDesc = stringsEn.skyMapVariants[varientTag];
                editStr += `Variation set as ${formatField('variation', variOpt.value)}, [${varientDesc}](${previewInfographic})\n`;
              }
            }
          }

          let isOverriding = optionsMap.has('override_reason_key') || optionsMap.has('override_reason');
          if (isOverriding) {
            if (optionsMap.has('override_reason_key')) {
              const reasonKeyOpt = optionsMap.get(
                'override_reason_key',
              ) as APIApplicationCommandInteractionDataStringOption;
              edits.overrideReason = reasonKeyOpt.value;
              editStr +=
                'Override reason set as `' +
                commonOverrideReasons[reasonKeyOpt.value as keyof typeof commonOverrideReasons] +
                '`\n';
            } else {
              const reasonOpt = optionsMap.get('override_reason') as APIApplicationCommandInteractionDataStringOption;
              edits.overrideReason = '!!!' + reasonOpt.value; // Prefix with !!! to indicate custom reason
              editStr += 'Override reason set as `' + reasonOpt.value + '`\n';
            }
          }

          if (optionsMap.has('clear_override')) {
            edits.override = null;
            edits.overrideReason = null;
            editStr += 'Override cleared\n';
            if (isOverriding) {
              isOverriding = false;
              editStr == '-- `clear_override` is used, override reason is ignored\n';
            }
          }

          await Promise.all([
            setDailyConfig(redis, date, edits, member.user.id),
            pushAuthorName(redis, member.user.id, resovledName),
            // InteractionCallback(discordRest, interaction),
          ]);

          if (optionsMap.has('override_reason_key') || optionsMap.has('override_reason')) {
            context.waitUntil(
              discordRest.post(Routes.webhook(context.env.DISCORD_CLIENT_ID, interaction.token), {
                body: generateOverwriteMenu(date),
              }),
            );
          }

          editStr += '\n\nRemember to </publish:1219872570669531247> after your changes are completed';

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: editStr, components },
          });
        }

        if (name === 'set_warning') {
          if (!isPlutoy) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: {
                content: 'Only Plutoy can set warnings',
                flags: MessageFlags.SuppressNotifications,
              },
            });
          }

          const typeOpt = optionsMap.get('type') as APIApplicationCommandInteractionDataStringOption;
          const type = typeOpt.value as keyof typeof warnings;

          const linkOpt = optionsMap.get('link') as APIApplicationCommandInteractionDataStringOption;
          if (type && !linkOpt) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: { content: 'Link is required for warnings' },
            });
          }

          await setWarning(redis, type, linkOpt.value);

          context.waitUntil(
            fetch(context.env.CLOUDFLARE_DEPLOY_URL, {
              method: 'POST',
            }),
          );

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content:
                'Warning set as `' +
                warnings[type] +
                '`\nMore information link to <' +
                linkOpt.value +
                '>\nAuto publishing...',
            },
          });
        }

        if (name === 'clear_warning') {
          if (!isPlutoy) {
            return InteractionResponse({
              type: InteractionResponseType.ChannelMessageWithSource,
              data: {
                content: 'Only Plutoy can clear warnings',
                flags: MessageFlags.SuppressNotifications,
              },
            });
          }

          await clearWarning(redis);

          context.waitUntil(
            fetch(context.env.CLOUDFLARE_DEPLOY_URL, {
              method: 'POST',
            }),
          );

          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: { content: 'Warning cleared\nAuto publishing...' },
          });
        }
      }

      if (name === 'remind_me') {
        // Max delay for qstash is 7 day.
        const next7Days = Array.from({ length: 7 }, (_, i) =>
          DateTime.local({ zone: 'America/Los_Angeles' }).plus({ days: i }),
        );
        const shardInfos = next7Days.map(date => getShardInfo(date));

        const next5HasConfig = shardInfos
          .filter(info => info.hasShard && (info.isRed || info.numVarient > 1))
          .slice(0, 5);

        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            flags: MessageFlags.Ephemeral,
            content: 'Which date do you want to be reminded?',
            components: [
              {
                type: ComponentType.ActionRow,
                components: next5HasConfig.map((info, i) =>
                  new ButtonBuilder()
                    .setCustomId(`remind_${info.date.toISODate()}`)
                    .setLabel(info.date.toFormat('yyyy-MM-dd'))
                    .setStyle(ButtonStyle.Primary)
                    .toJSON(),
                ),
              },
            ],
          },
        });
      }

      return InteractionResponse({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: `Unknown command: ${name} for <#${channel?.id}>` },
      });
    }
  } else if (interaction.type === InteractionType.MessageComponent) {
    const custom_id = interaction.data.custom_id;
    console.log('Message Component: ' + custom_id);
    if (custom_id.startsWith('publish_')) {
      if (custom_id === 'publish_confirm' || custom_id === 'publish_with_rescan_confirm') {
        const [confirmingUser, qstashMsgId] = await redis.mget<[string | null, string | null]>(
          'publish_confirmation_user',
          'qstash_message_id',
        );
        if (confirmingUser === null) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: 'This publish request has expired',
            },
          });
        }

        if (confirmingUser !== member.user.id) {
          return InteractionResponse({
            type: InteractionResponseType.ChannelMessageWithSource,
            data: {
              content: 'This publish request has to be confirmed by the original requester',
            },
          });
        }

        await Promise.all([
          redis.del('publish_confirmation_user', 'qstash_message_id'),
          redis.hset('publish_callback', { id: interaction.id, token: interaction.token }),
          custom_id === 'publish_with_rescan_confirm'
            ? redis.set('publish_rescan', 'true', { ex: 60 })
            : Promise.resolve(),
          // TODO: Clear QStash Sleep here
          qstash.messages.delete(qstashMsgId!),
        ]);

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
    } else if (custom_id.startsWith('override_')) {
      const { date, override, custom } = decodeOverrideCustomId(custom_id);
      console.log('Override Component', { date, override, custom });
      if (interaction.data.component_type === ComponentType.StringSelect) {
        const value = interaction.data.values[0];
        if (custom === 'select_group') {
          override.group = parseInt(value);
        } else if (custom === 'select_realm') {
          override.realm = parseInt(value);
        } else if (custom === 'select_map') {
          override.map = value;
        } else {
          throw new Error('Unknown custom id: ' + custom_id);
        }
        return InteractionResponse({
          type: InteractionResponseType.UpdateMessage,
          data: generateOverwriteMenu(date, override),
        });
      } else if (interaction.data.component_type === ComponentType.Button) {
        if (custom === 'cancel') {
          return InteractionResponse({
            type: InteractionResponseType.UpdateMessage,
            data: { content: 'Override has been cancelled', embeds: [], components: [] },
          });
        } else if (custom === 'confirm') {
          await setDailyConfig(redis, date, { override }, member.user.id);
          const { embeds } = generateOverwriteMenu(date, override, true);
          return InteractionResponse({
            type: InteractionResponseType.UpdateMessage,
            data: { content: 'Override has been confirmed', embeds, components: [] },
          });
        } else {
          // The action has been excuted and encoded in the custom id, no need to do anything
          return InteractionResponse({
            type: InteractionResponseType.UpdateMessage,
            data: generateOverwriteMenu(date, override),
          });
        }
      } else {
        throw new Error('Unknown component type: ' + interaction.data.component_type);
      }
    } else if (custom_id.startsWith('variation_')) {
    } else if (custom_id.startsWith('rollback_')) {
      const deployId = custom_id.slice(9);
      if (!isPlutoy) {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: 'Only Plutoy can perform a rollback',
            flags: MessageFlags.SuppressNotifications,
          },
        });
      }

      if (deployId === 'cancel') {
        return InteractionResponse({
          type: InteractionResponseType.UpdateMessage,
          data: {
            content: 'Rollback has been cancelled',
            components: [],
          },
        });
      }

      const deployUrl = `https://${deployId}.sky-shardfig.pages.dev/minified.json`;
      const res = await fetch(deployUrl);
      const data = (await res.json()) as RemoteConfigResponse;

      return InteractionResponse({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content: 'Rollback confirmation\n```json\n' + JSON.stringify(data, null, 2) + '\n```',
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                new ButtonBuilder()
                  .setCustomId(`confirm_rollback_${deployId}`)
                  .setLabel('Confirm')
                  .setStyle(ButtonStyle.Success)
                  .toJSON(),
                new ButtonBuilder()
                  .setCustomId('rollback_cancel')
                  .setLabel('Cancel')
                  .setStyle(ButtonStyle.Danger)
                  .toJSON(),
              ],
            },
          ],
        },
      });
    } else if (custom_id.startsWith('cfm_rollback_')) {
      const deployId = custom_id.slice(13);
      if (!isPlutoy) {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: 'Only Plutoy can perform a rollback',
            flags: MessageFlags.SuppressNotifications,
          },
        });
      }
      const rollbackUrl = `https://api.cloudflare.com/client/v4/accounts/${context.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/sky-shardfig/deployments/${deployId}/rollback`;
      const res = await fetch(rollbackUrl, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + context.env.CLOUDFLARE_API_TOKEN },
      });

      interface RollbackResponse {
        errors: { code: number; message: string }[];
        messages: { code: number; message: string }[];
        success: boolean;
      }

      const resBody = (await res.json()) as RollbackResponse;
      if (resBody.success) {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content:
              'Rollback successful: \n' +
              resBody.messages.map(m => 'Code: ' + m.code + ', Message: ' + m.message).join('\n'),
          },
        });
      } else {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content:
              'Rollback failed: \n' + resBody.errors.map(e => 'Code: ' + e.code + ', Message: ' + e.message).join('\n'),
          },
        });
      }
    } else if (custom_id.startsWith('remind_')) {
      const date = DateTime.fromISO(custom_id.slice(7), { zone: 'America/Los_Angeles' });
      const shardInfo = getShardInfo(date);

      if (!shardInfo.hasShard) {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: 'There is no shard for ' + date.toISODate(),
          },
        });
      }

      const remindDT = shardInfo.occurrences.find(o => o.land > DateTime.now())?.land;

      if (!remindDT) {
        return InteractionResponse({
          type: InteractionResponseType.ChannelMessageWithSource,
          data: {
            content: 'Shard has already landed for ' + date.toISODate(),
          },
        });
      }

      await qstash.publishJSON({
        url: context.env.DISCORD_REMINDER_WEBHOOK_URL,
        method: 'POST',
        notBefore: remindDT.toUnixInteger(),
        headers: { 'Content-Type': 'application/json' },
        body: {
          content:
            `<@${member.user.id}> Reminder for ${date.toISODate()}\n` +
            `${shardInfo.isRed ? 'Red' : 'Black'} Shard just landed in ${stringsEn.skyMaps[shardInfo.map as keyof typeof stringsEn.skyMaps]} and will be available until ${shardInfo.occurrences[0].end.toFormat("'<t:'X':t>'")}\n` +
            'Use the </remind_me:1251787925998403594> command to set more reminders',
          allowed_mentions: { users: [member.user.id] },
        } satisfies RESTPostAPIWebhookWithTokenJSONBody,
      });

      return InteractionResponse({
        type: InteractionResponseType.UpdateMessage,
        data: {
          flags: MessageFlags.Ephemeral,
          content: 'Reminder set for ' + date.toISODate(),
          components: [],
        },
      });
    }
  }

  // Always return 200 OK
  return new Response('OK', { status: 200 });
};
