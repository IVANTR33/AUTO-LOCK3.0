const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, // 🔑 Nuevo Import
    ButtonBuilder,   // 🔑 Nuevo Import
    ButtonStyle      // 🔑 Nuevo Import
} = require('discord.js');

// === FUNCIÓN AUXILIAR: RESUMEN DE CONTEO ===
// Función para generar el resumen de conteo (usada en execute y handlePagination)
const getCountSummary = (names, counts) => {
    return names
        .map(name => `**${name.charAt(0).toUpperCase() + name.slice(1)}**: ${counts[name] || 0}`)
        .join(' | ');
};

// === FUNCIÓN CLAVE: CREACIÓN DE BOTONES (Propia de gls.js) ===
// Esta función crea la ActionRow. Muestra [Prev] [Pág X/Y] [Next] [Cerrar] si hay >1 página,
// o solo [Cerrar] si hay 1 página.
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    // Lógica para más de una página: Muestra navegación completa
    if (totalPages > 1) {
        const isFirstPage = currentPage === 0;
        const isLastPage = currentPage === totalPages - 1;

        // 1. Botón Anterior (Prev)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}prev_page`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isFirstPage)
        );

        // 2. Botón de Información de Página (Pág X/Y)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info_gls_disabled') // ID inactivo
                .setLabel(`Pág ${currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        // 3. Botón Siguiente (Next)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}next_page`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isLastPage)
        );
    } 
    // 4. Botón Cerrar (Siempre se añade, independientemente del número de páginas)
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${customPrefix}close_list`)
            .setLabel('❌')
            .setStyle(ButtonStyle.Danger)
    );
    
    return row;
}


module.exports = {
    name: 'gls',
    description: 'Busca canales bloqueados por uno o varios Pokémon específicos en todos los servidores, mostrando un conteo individual.',
    // Ya no requerimos generatePaginationButtons en las dependencias
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        // 1. Parsear los argumentos: dividir por coma, limpiar espacios y convertir a minúsculas
        const searchPokemonNames = args.join(' ').toLowerCase().split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0); 

        if (searchPokemonNames.length === 0) {
            return message.reply('❌ Proporciona uno o más nombres de Pokémon separados por comas para buscar (ej: `!gls pichu, pikachu`).');
        }

        const searchPokemonString = searchPokemonNames.join(', ');
        const pokemonCounts = {}; 

        // Inicializar el conteo de todos los Pokémon buscados a 0
        searchPokemonNames.forEach(name => {
            pokemonCounts[name] = 0;
        });

        try {
            // Lógica de filtrado
            const lockedList = Array.from(lockedChannels.entries())
                .map(([id, data]) => {
                    const channel = client.channels.cache.get(id);
                    if (!channel) return null;
                    
                    let matchedName = null;
                    const isMatch = searchPokemonNames.some(searchName => {
                        if (data.pokemon.toLowerCase().includes(searchName)) {
                            matchedName = searchName; 
                            return true;
                        }
                        return false;
                    });
                    
                    if (isMatch) {
                        pokemonCounts[matchedName] = (pokemonCounts[matchedName] || 0) + 1; // Incrementar conteo
                        return {
                            id,
                            channelName: channel.name,
                            guildId: channel.guild.id, // Necesario para el link
                            guildName: channel.guild.name, // Necesario para la descripción
                            pokemon: data.pokemon || 'Desconocido',
                            type: data.type === 'private' ? 'Privado' : 'Público'
                        };
                    }
                    return null;
                })
                .filter(item => item !== null)
                .sort((a, b) => a.pokemon.localeCompare(b.pokemon));

            if (lockedList.length === 0) {
                const summary = getCountSummary(searchPokemonNames, pokemonCounts);
                return message.reply(`❌ No se encontraron canales bloqueados globalmente para: ${summary}.`);
            }

            const itemsPerPage = 5;
            const totalPages = Math.ceil(lockedList.length / itemsPerPage);
            const prefix = 'gls_'; 

            const generateEmbed = (currentPage) => {
                const start = currentPage * itemsPerPage;
                const end = start + itemsPerPage;
                const currentItems = lockedList.slice(start, end);
                const summary = getCountSummary(searchPokemonNames, pokemonCounts);

                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`🌍 Bloqueos globales coincidentes (${lockedList.length} Canales)`)
                    .setDescription(
                        `*Coincidencias por Pokémon:* ${summary}\n\n` + 
                        currentItems.map(item =>
                            `🔒 **${item.pokemon}** (${item.guildName} - Canal #${item.channelName})\n` +
                            `• Tipo: ${item.type}\n` +
                            `• [Ir al Canal](https://discord.com/channels/${item.guildId}/${item.id})`
                        ).join('\n\n')
                    )
                    .setFooter({ text: `Página ${currentPage + 1} de ${totalPages}` });

                return embed;
            };
            
            const initialState = { 
                currentPage: 0,
                lockedList,
                itemsPerPage,
                totalPages,
                messageAuthorId: message.author.id,
                commandName: 'gls', 
                customPrefix: prefix,
                // Datos adicionales
                searchPokemonNames,
                pokemonCounts
            };
            
            // 🔑 LÓGICA DE BOTONES: Siempre se envía la fila (ActionRow) para el botón X.
            const componentsToSend = [createPaginationRow(initialState.currentPage, totalPages, prefix)];

            const reply = await message.reply({ 
                embeds: [generateEmbed(initialState.currentPage)], 
                components: componentsToSend, 
                fetchReply: true
            });

            paginationStates.set(reply.id, initialState);
        } catch (error) {
            console.error('❌ Error en comando gls:', error);
            message.reply('❌ Ocurrió un error al buscar la lista de bloqueos globales.');
        }
    },
    
    // 🔑 handlePagination: Usa la función local y recibe dependencias corregidas.
    handlePagination: async (interaction, state, { paginationStates }) => {
        if (!interaction.customId.startsWith(state.customPrefix)) return;
        
        // Verificar si la interacción ha expirado 
        if (!paginationStates.has(interaction.message.id)) {
            return interaction.update({
                components: [], 
                content: '⌛ Esta interacción ha expirado (1 minuto)',
                embeds: []
            }).catch(() => {});
        }

        if (state.messageAuthorId !== interaction.user.id) {
            return interaction.reply({
                content: '❌ Solo el autor del comando puede interactuar con esta paginación.',
                ephemeral: true
            });
        }

        if (interaction.customId === `${state.customPrefix}close_list`) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => interaction.update({ components: [] }));
        }

        // Lógica de navegación (solo se activará si totalPages > 1)
        if (interaction.customId === `${state.customPrefix}prev_page` && state.currentPage > 0) {
            state.currentPage--;
        } else if (interaction.customId === `${state.customPrefix}next_page` && state.currentPage < state.totalPages - 1) {
            state.currentPage++;
        }
        
        // Regenerar el Embed
        const start = state.currentPage * state.itemsPerPage;
        const end = start + state.itemsPerPage;
        const currentItems = state.lockedList.slice(start, end);
        const summary = getCountSummary(state.searchPokemonNames, state.pokemonCounts);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`🌍 Bloqueos globales coincidentes (${state.lockedList.length} Canales)`)
            .setDescription(
                `*Coincidencias por Pokémon:* ${summary}\n\n` + 
                currentItems.map(item =>
                    `🔒 **${item.pokemon}** (${item.guildName} - Canal #${item.channelName})\n` +
                    `• Tipo: ${item.type}\n` +
                    `• [Ir al Canal](https://discord.com/channels/${item.guildId}/${item.id})`
                ).join('\n\n')
            )
            .setFooter({ text: `Página ${state.currentPage + 1} de ${state.totalPages}` });

        // Usamos la función local robusta para actualizar los botones
        await interaction.update({ 
            embeds: [embed], 
            components: [createPaginationRow(state.currentPage, state.totalPages, state.customPrefix)] 
        }).catch(console.error);
    }
};