const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'spawn',
    description: 'Busca Pokémon en spawns recientes de poke-name',
    cooldown: 15,
    async execute(client, message, args, { 
        paginationStates, 
        generatePaginationButtons,
        lockedChannels 
    }) {
        if (!args.length) return message.reply('❌ Ejemplo: `!spawn pikachu`');
        
        const searchTerm = args.join(' ').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const guild = message.guild;
        const guildName = guild.name.length > 20 ? guild.name.substring(0, 17) + '...' : guild.name;

        // 1. Obtener canales (usando caché de Discord.js para la lista, pero fetch individual para mensajes)
        const channels = guild.channels.cache.filter(c => 
            c.type === 0 && 
            /^\d{1,3}$/.test(c.name) && 
            parseInt(c.name) <= 450 &&
            !lockedChannels.has(c.id)
        ).sort((a, b) => parseInt(a.name) - parseInt(b.name));

        const totalChannels = channels.size;
        if (totalChannels === 0) return message.reply('❌ No hay canales válidos para escanear');

        // 2. Barra de progreso (#2 solicitada)
        const progressEmbed = new EmbedBuilder()
            .setColor(0xFFFF00)
            .setTitle('🔍 Escaneando canales...')
            .setDescription(
                `**Progreso:** [░░░░░░░░░░] 0%\n` +
                `🗄️ Servidor: ${guildName}\n` +
                `📺 Canales: 0/${totalChannels}\n` +
                `🔶 Spawns Detectados: 🔸[0]`
            );

        const progressMessage = await message.reply({ embeds: [progressEmbed] });

        // 3. Escaneo (sin cachear mensajes)
        const spawnResults = [];
        let channelsScanned = 0;

        for (const channel of channels.values()) {
            try {
                // Fetch del mensaje más reciente (¡sin cachear!)
                const messages = await channel.messages.fetch({ limit: 1 });
                const msg = messages.first();

                if (msg?.author.id === process.env.POKE_NAME_ID) {
                    const content = msg.content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    if (content.includes(searchTerm)) {
                        spawnResults.push({
                            channel: `#${channel.name}`,
                            url: `https://discord.com/channels/${guild.id}/${channel.id}/${msg.id}`,
                            time: msg.createdAt
                        });
                    }
                }
            } catch (error) {
                console.error(`Error en #${channel.name}:`, error);
            }

            channelsScanned++;

            // Actualizar progreso cada 5 canales o al final
            if (channelsScanned % 5 === 0 || channelsScanned === totalChannels) {
                const progressPercentage = Math.floor((channelsScanned / totalChannels) * 100);
                const filledBars = Math.floor(progressPercentage / 10);
                const progressBar = '█'.repeat(filledBars).padEnd(10, '░');

                progressEmbed.setDescription(
                    `**Progreso:** [${progressBar}] ${progressPercentage}%\n` +
                    `🗄️ Servidor: ${guildName}\n` +
                    `📺 Canales: ${channelsScanned}/${totalChannels}\n` +
                    `🔶 Spawns Detectados: 🔸[${spawnResults.length}]`
                );

                await progressMessage.edit({ embeds: [progressEmbed] });
            }
        }

        await progressMessage.delete().catch(console.error);

        // 4. Resultados (mostrando solo el término buscado)
        if (spawnResults.length === 0) {
            return message.reply(`❌ No se encontró "${args.join(' ')}" en los últimos spawns`);
        }

        const pages = [];
        spawnResults.sort((a, b) => b.time - a.time).forEach((result, i) => {
            const pageIndex = Math.floor(i / 5);
            if (!pages[pageIndex]) pages[pageIndex] = [];
            pages[pageIndex].push(result);
        });

        const createEmbed = (page) => new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`🔍 Resultados para "${args.join(' ')}"`)
            .setDescription(
                pages[page].map(r => `**${args.join(' ')}**\n${r.channel} • [Ver mensaje](${r.url})\nHace: <t:${Math.floor(r.time/1000)}:R>`).join('\n\n')
            )
            .setFooter({ text: `Página ${page + 1} de ${pages.length} | ${spawnResults.length} resultados` });

        const reply = await message.reply({
            embeds: [createEmbed(0)],
            components: pages.length > 1 ? [generatePaginationButtons(0, pages.length, 'spawn_')] : []
        });

        if (pages.length > 1) {
            paginationStates.set(reply.id, {
                commandName: 'spawn',
                messageAuthorId: message.author.id,
                currentPage: 0,
                totalPages: pages.length,
                pages: pages,
                pokemonName: args.join(' ')
            });
        }
    },
    handlePagination: async (interaction, state, generatePaginationButtons) => {
        if (interaction.customId.includes('_close_list')) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }

        let newPage = state.currentPage;
        if (interaction.customId === 'spawn_prev_page') newPage--;
        else if (interaction.customId === 'spawn_next_page') newPage++;

        if (newPage >= 0 && newPage < state.totalPages) {
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`🔍 Resultados para "${state.pokemonName}"`)
                .setDescription(
                    state.pages[newPage].map(r => `**${state.pokemonName}**\n${r.channel} • [Ver mensaje](${r.url})\nHace: <t:${Math.floor(r.time/1000)}:R>`).join('\n\n')
                )
                .setFooter({ text: `Página ${newPage + 1} de ${state.totalPages} | ${state.pages.flat().length} resultados` });

            await interaction.update({
                embeds: [embed],
                components: [generatePaginationButtons(newPage, state.totalPages, 'spawn_')]
            });
            
            state.currentPage = newPage;
            paginationStates.set(interaction.message.id, state);
        }
    }
};