import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPutAPIApplicationGuildCommandsJSONBody,
  RESTPutAPIApplicationGuildCommandsResult,
  Routes,
} from 'discord-api-types/v10';
import { memories } from '../shared/lib.js';

// Update Discord Command
try {
  // Setup the command in Discord in channel (1219629213238296676)
  const rest = new REST({ version: '10' }).setToken(
    process.env.DISCORD_BOT_TOKEN
  );

  const builders: RESTPutAPIApplicationGuildCommandsJSONBody = [];

  builders.push(
    new SlashCommandBuilder()
      .setName('set_daily')
      .setDescription('Set the daily config')
      .addIntegerOption(option =>
        option
          .setName('memory')
          .setDescription('Set the memory for the day')
          .setChoices(...memories.map((m, i) => ({ name: m, value: i })))
      )
      .addIntegerOption(option =>
        option
          .setName('variation')
          .setDescription('Set the variation for the day')
          .setMaxValue(3)
          .setMinValue(0)
      )
      .addStringOption(option =>
        option
          .setName('override_reason_key')
          .setDescription('Key for the override reason (translated)')
          .setChoices(
            {
              name: 'Disabled due to event occuring in the area',
              value: 'event_area',
            },
            {
              name: 'Bugged, Shard not spawning',
              value: 'bugged_shard',
            },
            {
              name: 'Memory bugged',
              value: 'bugged_memory',
            },
            {
              name: 'Altered by TGC',
              value: 'tgc_altered',
            }
          )
      )
      .addStringOption(option =>
        option
          .setName('override_reason')
          .setDescription('Reason for the override (non-translated)')
      )

      .toJSON()
  );

  // TODO: Add command for global config

  builders.push(
    new SlashCommandBuilder()
      .setName('publish')
      .setDescription('Publish the config to Sky-Shards')
  );

  const guildId = '1219255956207046727';
  const res = (await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
    { body: builders.map(b => b.toJSON()) }
  )) as RESTPutAPIApplicationGuildCommandsResult;

  console.log('Successfully registered application commands.');
  console.table(res.map(command => ({ name: command.name, id: command.id })));
} catch (err) {
  console.error(
    'Failed to update Discord Command',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}
