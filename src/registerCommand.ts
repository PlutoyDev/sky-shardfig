import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  RESTPutAPIApplicationGuildCommandsJSONBody,
  RESTPutAPIApplicationGuildCommandsResult,
  Routes,
} from 'discord-api-types/v10';
import { commonOverrideReasons, memories } from '../shared/lib.js';

if (process.env.DISCORD_CLIENT_ID === undefined) {
  throw new Error('Missing required environment variable: DISCORD_CLIENT_ID');
}

if (process.env.DISCORD_BOT_TOKEN === undefined) {
  throw new Error('Missing required environment variable: DISCORD_BOT_TOKEN');
}

// Update Discord Command
try {
  // Setup the command in Discord in channel (1219629213238296676)

  const commands = [];

  commands.push(
    new SlashCommandBuilder()
      .setName('set_daily')
      .setDescription('Set the daily config')
      .addIntegerOption(option =>
        option
          .setName('memory')
          .setDescription('Set the memory for the day')
          .setChoices(...memories.map((m, i) => ({ name: m, value: i })), { name: 'Remove', value: -1 }),
      )
      .addIntegerOption(option =>
        option
          .setName('variation')
          .setDescription('Set the variation for the day')
          .setChoices(...Array.from({ length: 4 }, (_, i) => ({ name: `Variation ${i + 1}`, value: i })), {
            name: 'Remove',
            value: -1,
          }),
      )
      .addStringOption(option =>
        option.setName('date').setDescription('Date of the config (YYYY-MM-DD, default today)'),
      )
      .addStringOption(option =>
        option
          .setName('override_reason_key')
          .setDescription('The reason for the override (translatable key)')
          .addChoices(...Object.entries(commonOverrideReasons).map(([k, str]) => ({ name: str, value: k }))),
      )
      .addStringOption(option =>
        option.setName('override_reason').setDescription('The reason for the override (custom text)'),
      )
      .addBooleanOption(option => option.setName('clear_override').setDescription('Clear the override'))
      .toJSON(),
  );

  // TODO: Add command for global config

  commands.push(
    new SlashCommandBuilder().setName('publish').setDescription('Publish the config to Sky-Shards').toJSON(),
  );

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

  const guildId = '1219255956207046727';
  const res = (await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId), {
    body: commands,
  })) as RESTPutAPIApplicationGuildCommandsResult;

  console.log('Successfully registered application commands.');
  console.table(res.map(command => ({ name: command.name, id: command.id })));
} catch (err) {
  console.error(
    'Failed to update Discord Command',
    err && typeof err === 'object' && 'message' in err ? err.message : err,
  );
}
