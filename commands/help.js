const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'help',
    description: 'Muestra la lista de comandos.',
    async execute(client, message, args, { loadWhitelists }) {
        const command = args[0]?.toLowerCase();

        const commandsInfo = {
            help: {
                description: 'Muestra esta lista de comandos',
                usage: '!help [comando]',
                examples: ['!help', '!help add']
            },
            add: {
                description: 'Añade Pokémon a la lista blanca',
                usage: '!add <public|private> <nombre1, nombre2, ...>',
                examples: [
                    '!add private pikachu, charizard',
                    '!add pub bulbasaur'
                ],
                aliases: ['pv', 'priv', 'privado', 'private', 'pb', 'pub', 'public', 'publica']
            },
            remove: {
                description: 'Elimina Pokémon de la lista blanca',
                usage: '!remove <public|private> <nombre1, nombre2, ...>',
                examples: [
                    '!remove private pikachu, charizard',
                    '!remove pub bulbasaur'
                ],
                aliases: ['pv', 'priv', 'privado', 'private', 'pb', 'pub', 'public', 'publica']
            },
            locklist: {
                description: 'Muestra los canales bloqueados (GLOBAL)',
                usage: '!locklist',
                examples: ['!locklist']
            },
            locks: { // Nuevo comando local agregado
                description: 'Muestra los canales bloqueados SOLO en este servidor',
                usage: '!locks',
                examples: ['!locks']
            },
            list: {
                description: 'Muestra la lista de Pokémon permitidos (pública, privada o ambas)',
                usage: '!list [public|private]',
                examples: [
                    '!list',
                    '!list public',
                    '!list private'
                ],
                aliases: ['pv', 'priv', 'privado', 'private', 'pb', 'pub', 'public', 'publica']
            },
            busca: {
                description: 'Busca Pokémon en las listas',
                usage: '!busca <nombre>',
                examples: ['!busca pikachu', '!busca char']
            },
            role: {
                description: 'Establece el rol a mencionar en bloqueos',
                usage: '!role @rol',
                examples: ['!role @Staff']
            },
            log: {
                description: 'Establece el canal para logs',
                usage: '!log #canal',
                examples: ['!log #logs']
            },
            lock: {
                description: 'Bloquea manualmente un canal de spawn y le asigna un nombre',
                usage: '!lock [#canal] <nombre>',
                examples: ['!lock', '!lock #canal2 Zygarde', '!lock Jirachi']
            },
            unlock: {
                description: 'Desbloquea manualmente un canal de spawn',
                usage: '!unlock [#canal]',
                examples: ['!unlock', '!unlock #canal2']
            },
            ls: {
                description: 'Busca canales bloqueados por un Pokémon específico en este servidor',
                usage: '!ls <nombre>',
                examples: ['!ls zygarde', '!ls pikachu']
            },
            ts: {
                description: 'Muestra el ranking de todos los Pokémon con canales bloqueados',
                usage: '!ts',
                examples: ['!ts']
            },
            spawn: {
                description: 'Busca un Pokémon en los últimos spawns del servidor actual',
                usage: '!spawn <nombre>',
                examples: ['!spawn rayquaza', '!spawn jirachi']
            },
            stats: {
                description: 'Muestra estadísticas avanzadas del bot (servidores, usuarios, canales bloqueados)',
                usage: '!stats',
                examples: ['!stats']
            }
        };

        if (command) {
            const cmd = Object.entries(commandsInfo).find(([key, info]) =>
                key === command || (info.aliases && info.aliases.includes(command))
            )?.[1];

            if (!cmd) {
                return message.reply(`❌ No se encontró información para el comando "${command}"`);
            }

            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(`Ayuda para: !${command}`)
                .addFields(
                    { name: 'Descripción', value: cmd.description },
                    { name: 'Uso', value: `\`${cmd.usage}\`` },
                    { name: 'Ejemplos', value: cmd.examples.map(e => `\`${e}\``).join('\n') }
                );

            if (cmd.aliases && cmd.aliases.length > 0) {
                embed.addFields({ name: 'Alias', value: cmd.aliases.join(', ') });
            }

            message.reply({ embeds: [embed] });
        } else {
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('📝 Lista de Comandos')
                .setDescription('Usa `!help <comando>` para más detalles')
                .addFields(
                    Object.entries(commandsInfo).map(([name, info]) => ({
                        name: `!${name}`,
                        value: info.description,
                        inline: true
                    }))
                );
            message.reply({ embeds: [embed] });
        }
    },
};