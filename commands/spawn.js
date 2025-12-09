const { EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'spawn',
    description: 'Busca Pokémon en spawns recientes detectados por los bots de nombres, ignorando canales con captura y canales bloqueados.',
    cooldown: 15,
    async execute(client, message, args, {
        paginationStates,
        generatePaginationButtons,
        lockedChannels,
        NAME_BOT_IDS,
        POKETWO_ID = process.env.POKETWO_ID, 
        extractPokemonName, 
        normalizeForComparison 
    }) {
        // Validación de dependencias
        if (!extractPokemonName || !normalizeForComparison || !POKETWO_ID || !generatePaginationButtons) {
            return message.reply('❌ Error de configuración: Faltan utilidades (extractPokemonName, normalizeForComparison, generatePaginationButtons) o la variable POKETWO_ID. (Verificar index.js)');
        }

        if (!args.length) return message.reply('❌ Ejemplo: `!spawn pikachu`');

        const searchTerm = normalizeForComparison(args.join(' ')); 

        const guild = message.guild;
        const guildName = guild.name.length > 20 ? guild.name.substring(0, 17) + '...' : guild.name;

        // 1. Obtener canales (filtrando por nombre, límite y EXCLUYENDO canales bloqueados)
        const channels = guild.channels.cache.filter(c =>
            c.type === 0 &&
            /^\d{1,3}$/.test(c.name) &&
            parseInt(c.name) <= 450 &&
            !lockedChannels.has(c.id)
        ).sort((a, b) => parseInt(a.name) - parseInt(b.name));

        const totalChannels = channels.size;
        if (totalChannels === 0) return message.reply('❌ No hay canales válidos para escanear');

        // 2. Barra de progreso
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

        // 3. Escaneo Avanzado (BUSCANDO EL SPAWN MÁS RECIENTE)
        const spawnResults = [];
        let channelsScanned = 0;
        const messagesToFetch = 10; 

        const CAPTURE_KEYWORD = 'you caught a'; 
        const SPAWN_KEYWORD = 'a wild pokémon has appeared';

        for (const channel of channels.values()) {
            let isCaptured = false;
            let matchResult = null;
            let mostRecentSpawnTime = 0; 

            try {
                const messages = await channel.messages.fetch({ limit: messagesToFetch });
                const messageArray = Array.from(messages.values());
                
                // === Fase 1: Detectar Capturas y Spawn Más Reciente ===
                for (const msg of messageArray) {
                    const contentLower = msg.content?.toLowerCase() || '';

                    // Prioridad A: Detección de Captura (Si se detecta, se descarta el canal completo)
                    if (msg.author.id === POKETWO_ID && contentLower.includes(CAPTURE_KEYWORD)) {
                        isCaptured = true;
                        break; 
                    }

                    // Prioridad B: Rastrear el Spawn más reciente
                    const isSpawn = msg.author.id === POKETWO_ID && (
                        (contentLower.includes(SPAWN_KEYWORD)) ||
                        (msg.embeds && msg.embeds.length > 0 && (msg.embeds[0].image || msg.embeds[0].title || msg.embeds[0].description))
                    );
                    if (isSpawn) {
                        if (msg.createdAt.getTime() > mostRecentSpawnTime) {
                            mostRecentSpawnTime = msg.createdAt.getTime();
                        }
                    }
                }
                
                if (isCaptured) {
                    // Si fue capturado, saltamos la Fase 2 y actualizamos el progreso
                    channelsScanned++;
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
                        await progressMessage.edit({ embeds: [progressEmbed] }).catch(() => {});
                    }
                    continue; // Saltar al siguiente canal
                }

                // === Fase 2: Buscar el Bot de Nombres Coincidente Más Reciente ===
                for (let i = 0; i < messageArray.length; i++) {
                    const currentMsg = messageArray[i];
                    
                    if (NAME_BOT_IDS.includes(currentMsg.author.id)) {
                        const extracted = extractPokemonName(currentMsg.content, currentMsg.author.id);
                        const normalizedExtracted = normalizeForComparison(extracted);
                        
                        if (normalizedExtracted === searchTerm) {
                            
                            // Si el spawn más reciente (mostRecentSpawnTime) es *posterior* al mensaje del bot de nombres, 
                            // el bot de nombres pertenece a un spawn viejo y se ignora, continuando el bucle.
                            if (mostRecentSpawnTime > currentMsg.createdAt.getTime()) {
                                continue; 
                            }
                            
                            // Si el mensaje del bot de nombres es igual o posterior al spawn más nuevo, es un match válido.
                            matchResult = {
                                channel: `#${channel.name}`,
                                url: `https://discord.com/channels/${guild.id}/${channel.id}/${currentMsg.id}`,
                                time: currentMsg.createdAt,
                                pokemonName: extracted 
                            };
                            break; // Encontramos el match más reciente que cumple la condición.
                        }
                    }
                }

                // 4. Agregar resultado (ya filtramos por captura y por spawn más reciente)
                if (matchResult) {
                    spawnResults.push(matchResult);
                }

            } catch (error) {
                console.error(`Error al escanear canal #${channel.name}:`, error.message);
            }

            channelsScanned++;

            // 5. Actualizar progreso
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

                await progressMessage.edit({ embeds: [progressEmbed] }).catch(() => {});
            }
        }

        await progressMessage.delete().catch(() => {});

        // 6. Resultados y Paginación
        if (spawnResults.length === 0) {
            return message.reply(`❌ No se encontró "${args.join(' ')}" en los spawns más recientes no capturados.`);
        }

        const pages = [];
        spawnResults.sort((a, b) => b.time - a.time).forEach((result, i) => {
            const pageIndex = Math.floor(i / 5);
            if (!pages[pageIndex]) pages[pageIndex] = [];
            pages[pageIndex].push(result);
        });

        const originalSearchName = args.join(' ');

        const createEmbed = (page) => new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`🔍 Resultados para "${originalSearchName}"`)
            .setDescription(
                pages[page].map(r => 
                    `**${r.pokemonName.toUpperCase()}**\n${r.channel} • [Ver mensaje](${r.url})\nHace: <t:${Math.floor(r.time/1000)}:R>`
                ).join('\n\n')
            )
            .setFooter({ text: `Página ${page + 1} de ${pages.length} | ${spawnResults.length} resultados` });

        const reply = await message.reply({
            embeds: [createEmbed(0)],
            components: pages.length > 1 ? [generatePaginationButtons({currentPage: 0, totalPages: pages.length, customIdPrefix: 'spawn_'})] : []
        });

        if (pages.length > 1) {
            paginationStates.set(reply.id, {
                commandName: 'spawn',
                messageAuthorId: message.author.id,
                currentPage: 0,
                totalPages: pages.length,
                pages: pages,
                pokemonName: originalSearchName 
            });
        }
    },
    handlePagination: async (interaction, state, dependencies) => {
        const { paginationStates, generatePaginationButtons } = dependencies;

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
                    state.pages[newPage].map(r => 
                        `**${r.pokemonName.toUpperCase()}**\n${r.channel} • [Ver mensaje](${r.url})\nHace: <t:${Math.floor(r.time/1000)}:R>`
                    ).join('\n\n')
                )
                .setFooter({ text: `Página ${newPage + 1} de ${state.totalPages} | ${state.pages.flat().length} resultados` });

            await interaction.update({
                embeds: [embed],
                components: [generatePaginationButtons({currentPage: newPage, totalPages: state.totalPages, customIdPrefix: 'spawn_'})]
            });

            state.currentPage = newPage;
            paginationStates.set(interaction.message.id, state);
        }
    }
};
