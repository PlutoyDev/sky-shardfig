import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import {
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

  const setMemoryCommand = new SlashCommandBuilder()
    .setName('set_memory')
    .setDescription('Set the daily memory')
    .addStringOption(option =>
      option
        .setName('memory')
        .setDescription('The memory for the day')
        .setRequired(true)
        .addChoices(
          ...memories.map(memory => ({ name: memory, value: memory }))
        )
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription(
          'The date to set the memory for in ISO format (YYYY-MM-DD), defaults to today'
        )
    );

  const setVariationCommand = new SlashCommandBuilder()
    .setName('set_variation')
    .setDescription('Set the daily variation')
    .addNumberOption(option =>
      option
        .setName('variation')
        .setDescription('The variation (0, 1, 2, or 3) for the day')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(3)
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription(
          'The date to set the variation for in ISO format (YYYY-MM-DD), defaults to today'
        )
    );

  const setBuggedStatusCommand = new SlashCommandBuilder()
    .setName('set_bugged_status')
    .setDescription('Set the daily bugged status')
    .addBooleanOption(option =>
      option
        .setName('is_bugged')
        .setDescription('Is the shard bugged?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('bug_type')
        .setDescription('The type of bug')
        .addChoices(
          { name: 'No Shard', value: 'noShard' },
          { name: 'No Memory', value: 'noMemory' }
        )
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription(
          'The date to set the bugged status for in ISO format (YYYY-MM-DD), defaults to today'
        )
    );

  const setDisabledStatusCommand = new SlashCommandBuilder()
    .setName('set_disabled_status')
    .setDescription('Set the daily disabled status')
    .addBooleanOption(option =>
      option
        .setName('is_disabled')
        .setDescription('Is the shard disabled?')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('The reason for the shard being disabled')
    )
    .addStringOption(option =>
      option
        .setName('date')
        .setDescription(
          'The date to set the disabled status for in ISO format (YYYY-MM-DD), defaults to today'
        )
    );

  const publishCommand = new SlashCommandBuilder()
    .setName('publish')
    .setDescription('Publish the config to Sky-Shards');

  const commands = [
    setMemoryCommand,
    setVariationCommand,
    setBuggedStatusCommand,
    setDisabledStatusCommand,
    publishCommand,
  ].map(command => command.toJSON());

  const guildId = '1219255956207046727';
  const res = (await rest.put(
    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
    { body: commands }
  )) as RESTPutAPIApplicationGuildCommandsResult;

  console.log('Successfully registered application commands.');
  console.table(res.map(command => ({ name: command.name, id: command.id })));
} catch (err) {
  console.error(
    'Failed to update Discord Command',
    err && typeof err === 'object' && 'message' in err ? err.message : err
  );
}
