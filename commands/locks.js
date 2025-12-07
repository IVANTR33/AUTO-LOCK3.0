// locks.js v1.0.4 (Sincronización Visual Forzada)
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

//=====createChannelLinkRows (Mismo)=====
function createChannelLinkRows(currentItems, guildId, startItemIndex = 0) {
    const rows = [];
    let currentRow = new ActionRowBuilder();

    currentItems.forEach((item, index) => {
        const channelUrl = `https://discord.com/channels/${guildId}/${item.id}`;
        const itemNumber = startItemIndex + index + 1;
        
        const button = new ButtonBuilder()
            .setLabel(`#${itemNumber}`) 
            .setStyle(ButtonStyle.Link) 
            .setURL(channelUrl);
        
        currentRow.addComponents(button);

        if (currentRow.components.length === BUTTONS_PER_ROW) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
    });

    if (currentRow.components.length > 0) {
        rows.push(currentRow);
    }
    
    return rows;
}
//==================================================

//=====createPaginationRow (Mismo)=====
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    if (totalPages > 1) {
        const isFirstPage = currentPage === 0;
        const isLastPage = currentPage === totalPages - 1;

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_prev_page`) 
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isFirstPage)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info_locks_disabled') 
                .setLabel(`Pág ${currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_next_page`) 
                .setLabel('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isLastPage)
        );
    }

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${customPrefix}_close_list`) 
            .setLabel('❌ Cerrar')
            .setStyle(ButtonStyle.Danger)
    );

    return row;
}
//==================================================

//=====getLockedChannelsInGuild (Mismo)=====
function getLockedChannelsInGuild(client, guildId, freshLockedChannelsCollection) {
    
    if (!freshLockedChannelsCollection || typeof freshLockedChannelsCollection.entries !== 'function') {
        return []; 
    }
    
    const lockedList = Array.from(freshLockedChannelsCollection.entries())
        .map(([id, data]) => {
            const channel = client.channels.cache.get(id); 
            
            if (!channel || channel.guild.id !== guildId) return null; 
            
            return {
                id,
                channelName: channel.name,
                pokemon: data.pokemon || 'Desconocido',
                type: data.type === 'private' ? 'Privado' : 'Público'
            };
        })
        .filter(item => item !== null) 
        .sort((a, b) => {
            if (a.type === 'Privado' && b.type !== 'Privado') return -1;
            if (a.type !== 'Privado' && b.type === 'Privado') return 1;
            return a.pokemon.localeCompare(b.pokemon);
        });

    return lockedList;
}
//==================================================

//=====generateListOutput (Mismo)=====
function generateListOutput(client, guildId, state, freshLockedChannelsCollection) {
    
    const lockedList = getLockedChannelsInGuild(client, guildId, freshLockedChannelsCollection);
    
    const totalPages = Math.ceil(lockedList.length / ITEMS_PER_PAGE);
    
    let newPage = state.currentPage;
    
    if (newPage >= totalPages && totalPages > 0) {
        newPage = totalPages - 1;
    } else if (totalPages === 0) {
        newPage = 0; 
    }
    
    state.totalPages = totalPages;
    state.currentPage = newPage;
    
    const start = state.currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentItems = lockedList.slice(start, end);
    
    const embed = new EmbedBuilder()
        .setColor(0xEE82EE) 
        .setTitle(`📋 Bloqueos Locales (${lockedList.length} Canales)`)
        .setDescription(
            lockedList.length === 0 
                ? 'No hay canales bloqueados actualmente en este servidor.'
                : currentItems.map((item, index) =>
                      `**[#${start + index + 1}]** 🔒 **${item.pokemon}** (Canal #${item.channelName}) - Tipo: ${item.type}`
                  ).join('\n') +
                  `\n\nPresiona el botón \`#1\`, \`#2\`, etc. para ir directamente al canal.` 
        )
        .setFooter({ text: totalPages > 0 ? `Página ${state.currentPage + 1} de ${totalPages}` : `Página 0 de 0` });

    const linkRows = createChannelLinkRows(currentItems, guildId, start);
    const paginationRow = createPaginationRow(state.currentPage, state.totalPages, state.customPrefix);
    
    const components = [...linkRows, paginationRow];

    return { embed, components, shouldDelete: lockedList.length === 0 };
}
//==================================================

//=====updateActiveLists (MODIFICADA: Añade Timestamp para forzar el renderizado)=====
async function updateActiveLists(client, paginationStates, lockedChannels) { 
    
    const messagesToUpdate = [];

    for (const [messageId, state] of paginationStates) {
        if (state.commandName === 'locks') { 
            messagesToUpdate.push({ 
                messageId, 
                channelId: state.channelId, 
                guildId: state.guildId 
            });
        }
    }

    for (const { messageId, channelId, guildId } of messagesToUpdate) {
        const state = paginationStates.get(messageId);
        if (!state) continue;

        try {
            const channel = client.channels.cache.get(channelId);
            if (!channel) {
                paginationStates.delete(messageId);
                continue;
            }
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                paginationStates.delete(messageId);
                continue;
            }
            
            // Genera la salida con la data fresca (lockedChannels)
            const { embed, components, shouldDelete } = generateListOutput(
                client, 
                guildId, 
                state, 
                lockedChannels
            );

            // Importante: Volver a guardar el estado actualizado (solo con paginación)
            paginationStates.set(messageId, state);

            if (shouldDelete) {
                await message.delete().catch(() => {});
                paginationStates.delete(messageId);
            } else {
                
                // 🔑 AJUSTE V1.0.4: Añadir un timestamp para forzar a Discord a ver el embed como 'nuevo'.
                embed.setTimestamp(Date.now()); 

                await message.edit({ embeds: [embed], components: components })
                    .catch(error => {
                        if (error.code === 10008 || error.code === 50001) { 
                            paginationStates.delete(messageId);
                        } else {
                            console.error(`❌ Error al editar mensaje locks (sincronización):`, error.message);
                        }
                    });
            }
        } catch (error) {
            console.error(`❌ Error general al actualizar mensaje locks (${messageId}). Eliminando estado:`, error.message);
            paginationStates.delete(messageId);
        }
    }
}
//==================================================


module.exports = {
    name: 'locks', 
    description: 'Muestra los canales bloqueados SOLO en este servidor, con botones de navegación rápida.',
    
    //=====execute (Mismo)=====
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ ¡No tienes los permisos para usar este comando!');
        }
        
        const customPrefix = 'locks'; 

        const initialState = { 
            currentPage: 0,
            itemsPerPage: ITEMS_PER_PAGE,
            messageAuthorId: message.author.id,
            commandName: 'locks', 
            customPrefix: customPrefix,
            guildId: message.guild.id, 
            channelId: message.channel.id,
            timestamp: Date.now()
        };
        
        const { embed, components, shouldDelete } = generateListOutput(
            client, 
            message.guild.id, 
            initialState, 
            lockedChannels 
        );
        
        if (shouldDelete) {
            return message.reply('❌ No hay canales bloqueados actualmente en este servidor.');
        }

        const reply = await message.reply({ 
            embeds: [embed], 
            components: components, 
            fetchReply: true
        });

        paginationStates.set(reply.id, initialState);
    },
    //==================================================
    
    //=====handlePagination (Mismo)=====
    async handlePagination(interaction, state, dependencies) {
        
        const { paginationStates, lockedChannels } = dependencies;
        
        await interaction.deferUpdate().catch(() => {});
        
        // Cierre de lista
        if (interaction.customId === `${state.customPrefix}_close_list`) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }
        
        let newPage = state.currentPage;
        let shouldEdit = false;

        // Lógica de paginación
        if (interaction.customId === `${state.customPrefix}_prev_page` && state.currentPage > 0) {
            newPage = state.currentPage - 1;
            shouldEdit = true;
        } else if (interaction.customId === `${state.customPrefix}_next_page` && state.currentPage < state.totalPages - 1) {
            newPage = state.currentPage + 1;
            shouldEdit = true;
        } else {
             return; 
        }

        state.currentPage = newPage;
        
        const { embed, components, shouldDelete } = generateListOutput(
            interaction.client, 
            interaction.guild.id, 
            state, 
            lockedChannels 
        );

        if (shouldDelete) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }

        paginationStates.set(interaction.message.id, state);
        
        await interaction.message.edit({ 
            embeds: [embed], 
            components: components
        }).catch(error => {
            if (error.code === 10008 || error.code === 50001) { 
                paginationStates.delete(interaction.message.id);
            } else {
                console.error('❌ Error al paginar locks:', error.message);
            }
        });
    },
    //==================================================
    
    //=====updateActiveListsExport=====
    updateActiveLists: updateActiveLists
    //==================================================
};
