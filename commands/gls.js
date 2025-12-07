const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle,
    Collection      
} = require('discord.js');

const ITEMS_PER_PAGE = 15; 
const BUTTONS_PER_ROW = 5;

//=====getCountSummary=====
const getCountSummary = (names, counts) => {
    return names
        .map(name => `**${name.charAt(0).toUpperCase() + name.slice(1)}**: ${counts[name] || 0}`)
        .join(' | ');
};

//=====createPaginationRow=====
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    if (totalPages > 1) {
        const isFirstPage = currentPage === 0;
        const isLastPage = currentPage === totalPages - 1;

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}prev_page`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isFirstPage)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info_gls_disabled')
                .setLabel(`Pág ${currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}next_page`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isLastPage)
        );
    } 
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${customPrefix}close_list`)
            .setLabel('❌')
            .setStyle(ButtonStyle.Danger)
    );
    
    return row;
}

//=====createGlobalChannelLinkRows=====
function createGlobalChannelLinkRows(currentItems, startItemIndex = 0) {
    const rows = [];
    let currentRow = new ActionRowBuilder();
    let buttonCount = 0;

    currentItems.forEach((item, index) => {
        const label = `${index + 1 + startItemIndex}. ${item.pokemon}`; 
        
        const button = new ButtonBuilder()
            .setLabel(label.substring(0, 80)) 
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${item.guildId}/${item.id}`);

        if (buttonCount >= BUTTONS_PER_ROW) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
            buttonCount = 0;
        }

        currentRow.addComponents(button);
        buttonCount++;
    });

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }
    return rows;
}

//=====filterAndGenerateList (Extrae los datos sin mutar el estado)=====
function filterAndGenerateList(client, searchPokemonNames, lockedChannelsCollection) {
    const pokemonCounts = {}; 
    searchPokemonNames.forEach(name => {
        pokemonCounts[name] = 0;
    });

    const lockedList = Array.from(lockedChannelsCollection.entries()) 
        .map(([id, data]) => {
            const channel = client.channels.cache.get(id);
            // 🔑 Asegura que el canal exista en cache y tenga un guild (es un canal de texto o voz válido)
            if (!channel || !channel.guild) return null; 
            
            let matchedName = null;
            const isMatch = searchPokemonNames.some(searchName => {
                if (data.pokemon.toLowerCase().includes(searchName)) {
                    matchedName = searchName; 
                    return true;
                }
                return false;
            });
            
            if (isMatch) {
                pokemonCounts[matchedName] = (pokemonCounts[matchedName] || 0) + 1;
                return {
                    id,
                    channelName: channel.name,
                    guildId: channel.guild.id,
                    guildName: channel.guild.name,
                    pokemon: data.pokemon || 'Desconocido',
                    type: data.type === 'private' ? 'Privado' : 'Público'
                };
            }
            return null;
        })
        .filter(item => item !== null)
        .sort((a, b) => a.pokemon.localeCompare(b.pokemon));
        
    return { lockedList, pokemonCounts };
}

//=====regenerateListState (Mutación segura del estado)=====
function regenerateListState(client, state, freshLockedChannelsCollection) {
    const oldLength = state.lockedList.length;
    // Serializar IDs para una comparación de contenido
    const oldIds = state.lockedList.map(item => item.id).sort().join(',');

    const { lockedList, pokemonCounts } = filterAndGenerateList(client, state.searchPokemonNames, freshLockedChannelsCollection);
    
    const newTotalPages = Math.ceil(lockedList.length / state.itemsPerPage);
    
    // 1. Verificar si hubo un cambio real en el contenido
    const newIds = lockedList.map(item => item.id).sort().join(',');
    const contentChanged = oldLength !== lockedList.length || oldIds !== newIds;

    let newPage = state.currentPage;
    let pageAdjusted = false;

    // 2. Ajustar la página actual si es inválida
    if (newPage >= newTotalPages && newTotalPages > 0) {
        newPage = newTotalPages - 1;
        pageAdjusted = true;
    } else if (newTotalPages === 0) {
        newPage = 0; 
        if (oldLength > 0) pageAdjusted = true; 
    }

    // 3. Aplicar los nuevos datos al estado
    state.lockedList = lockedList;
    state.pokemonCounts = pokemonCounts;
    state.totalPages = newTotalPages;
    state.currentPage = newPage;

    // Retornar si hubo cambio de contenido O ajuste de página
    return contentChanged || pageAdjusted;
}

//=====generateListOutput (Solo renderiza el estado actual)=====
function generateListOutput(state) {
    let { lockedList, pokemonCounts, totalPages, currentPage } = state;

    if (lockedList.length === 0) {
        return { embed: new EmbedBuilder(), components: [], shouldDelete: true };
    }

    const start = currentPage * state.itemsPerPage;
    const end = start + state.itemsPerPage;
    const currentItems = lockedList.slice(start, end);
    const summary = getCountSummary(state.searchPokemonNames, pokemonCounts);

    const detailedList = currentItems.map((item, index) =>
        `**${index + 1 + start}.** 🔒 **${item.pokemon}** (${item.guildName} - Canal #${item.channelName}) - Tipo: ${item.type}`
    ).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🌍 Bloqueos globales coincidentes (${lockedList.length} Canales)`)
        .setDescription(
            `*Coincidencias por Pokémon:* ${summary}\n\n` +
            `**Canales Bloqueados (Pág ${currentPage + 1}/${totalPages}):**\n` +
            detailedList
        )
        .setFooter({ text: 'Botones abajo son enlaces directos a los canales.' });

    const channelRows = createGlobalChannelLinkRows(currentItems, start);
    const paginationRow = createPaginationRow(currentPage, totalPages, state.customPrefix);
    
    const components = [...channelRows, paginationRow];
    
    return { embed, components, shouldDelete: false };
}

//=====updateActiveLists (Función para el bucle de index actual.js)=====
async function updateActiveLists(client, paginationStates, lockedChannels) {
    const messagesToUpdate = [];

    for (const [messageId, state] of paginationStates) {
        if (state.commandName === 'gls') { 
            messagesToUpdate.push({ messageId, channelId: state.messageChannelId });
        }
    }

    for (const { messageId, channelId } of messagesToUpdate) {
        const state = paginationStates.get(messageId);
        if (!state) continue;

        try {
            // 🔑 CLAVE: Regenerar la lista y determinar si hubo un cambio
            const shouldUpdateMessage = regenerateListState(client, state, lockedChannels);

            // Si no hay cambios en la lista ni ajuste de página, omitir edición.
            if (!shouldUpdateMessage) {
                continue;
            }

            const { embed, components, shouldDelete } = generateListOutput(state);
            
            const channel = client.channels.cache.get(channelId);
            if (!channel) {
                paginationStates.delete(messageId);
                continue;
            }

            // Buscar el mensaje ANTES de intentar editar
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                paginationStates.delete(messageId);
                continue;
            }
            
            if (shouldDelete) {
                await message.delete().catch(() => {});
                paginationStates.delete(messageId);
            } else {
                paginationStates.set(messageId, state); 
                
                await message.edit({ embeds: [embed], components: components })
                    .catch(error => {
                        // 🔑 CORRECCIÓN CLAVE: Limpiar el estado ante un fallo de edición.
                        if (error.code === 10008 || error.code === 50001) { // Mensaje no encontrado o sin permisos
                             paginationStates.delete(messageId);
                        } else {
                             console.error(`❌ Error al editar mensaje gls (sincronización):`, error);
                        }
                    });
            }
        } catch (error) {
            console.error(`❌ Error general al actualizar mensaje gls (${messageId}). Eliminando estado:`, error);
            paginationStates.delete(messageId);
        }
    }
}
//==================================================

//=====module.exports=====
module.exports = {
    name: 'gls',
    description: 'Busca canales bloqueados por uno o varios Pokémon específicos en todos los servidores, mostrando un conteo individual.',
    
    //=====execute (Crea el estado inicial)=====
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return message.reply({ content: '❌ Se requieren permisos para gestionar canales para usar este comando.', flags: 64 });
        }
        
        const searchPokemonNames = args.join(' ').toLowerCase().split(',')
            .map(p => p.trim())
            .filter(p => p.length > 0); 

        if (searchPokemonNames.length === 0) {
            return message.reply('❌ Proporciona uno o más nombres de Pokémon separados por comas para buscar (ej: `!gls pichu, pikachu`).');
        }

        try {
            const { lockedList, pokemonCounts } = filterAndGenerateList(client, searchPokemonNames, lockedChannels);

            const totalPages = Math.ceil(lockedList.length / ITEMS_PER_PAGE);
            const prefix = 'gls_'; 
            
            const initialState = { 
                currentPage: 0,
                lockedList,
                itemsPerPage: ITEMS_PER_PAGE,
                totalPages,
                messageAuthorId: message.author.id,
                commandName: 'gls', 
                customPrefix: prefix,
                searchPokemonNames, 
                pokemonCounts,
                messageChannelId: message.channel.id 
            };

            const { embed, components, shouldDelete } = generateListOutput(initialState);
            
            if (shouldDelete) {
                const summary = getCountSummary(searchPokemonNames, pokemonCounts);
                return message.reply(`❌ No se encontraron canales bloqueados globalmente para: ${summary}.`);
            }

            const reply = await message.reply({ 
                embeds: [embed], 
                components: components, 
                fetchReply: true
            });

            paginationStates.set(reply.id, initialState);
        } catch (error) {
            console.error('❌ Error en comando gls:', error);
            message.reply('❌ Ocurrió un error al buscar la lista de bloqueos globales.');
        }
    },
    
    //=====handlePagination (Solo navegación manual)=====
    async handlePagination(interaction, state, { paginationStates }) { 
        
        await interaction.deferUpdate().catch(() => {});
        
        if (interaction.customId === `${state.customPrefix}close_list`) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }

        const isStaff = interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);
        if (state.messageAuthorId !== interaction.user.id && !isStaff) {
            return interaction.followUp({
                content: '❌ Solo el autor del comando puede interactuar con esta paginación.',
                ephemeral: true
            });
        }
        
        let shouldEdit = false;

        if (interaction.customId === `${state.customPrefix}prev_page` && state.currentPage > 0) {
            state.currentPage--;
            shouldEdit = true;
        } else if (interaction.customId === `${state.customPrefix}next_page` && state.currentPage < state.totalPages - 1) {
            state.currentPage++;
            shouldEdit = true;
        } else {
            return; 
        }
        
        if (shouldEdit) { 
            const { embed, components, shouldDelete } = generateListOutput(state); 
            
            if (shouldDelete) {
                paginationStates.delete(interaction.message.id);
                return interaction.message.delete().catch(() => {});
            }

            paginationStates.set(interaction.message.id, state);

            await interaction.message.edit({ 
                embeds: [embed], 
                components: components
            }).catch(error => {
                // Limpiar el estado ante un fallo de edición.
                if (error.code === 10008 || error.code === 50001) { 
                     paginationStates.delete(interaction.message.id);
                } else {
                     console.error('❌ Error al paginar gls:', error);
                }
            });
        }
    },
    
    //=====updateActiveListsExport=====
    updateActiveLists: updateActiveLists
    //==================================================
};
