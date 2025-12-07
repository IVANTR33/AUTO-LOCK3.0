const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle,
    Collection      
} = require('discord.js');

const path = require('path');
const lockedChannelsPath = path.join(__dirname, '..', 'locked_channels.json'); 
const fs = require('fs');

const ITEMS_PER_PAGE = 15; 
const BUTTONS_PER_ROW = 5; 

//=====I/O Helpers=====
function loadLockedChannelsSafe() { 
    try {
        if (!fs.existsSync(lockedChannelsPath)) return {};
        const data = fs.readFileSync(lockedChannelsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Error al cargar locked_channels.json:", error);
        return {};
    }
}
//==================================================

//=====getCountSummary=====
const getCountSummary = (names, counts) => {
    return names
        .map(name => `**${name.charAt(0).toUpperCase() + name.slice(1)}**: ${counts[name] || 0}`)
        .join(' | ');
};
//==================================================

//=====createChannelLinkRows=====
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

//=====createPaginationRow=====
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    if (totalPages > 1) {
        const isFirstPage = currentPage === 0;
        const isLastPage = currentPage === totalPages - 1;

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_prev_page`) 
                .setLabel('Anterior')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isFirstPage)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info_ls_disabled') 
                .setLabel(`Pág ${currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_next_page`) 
                .setLabel('Siguiente')
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

//=====getLockedChannelsInGuild=====
function getLockedChannelsInGuild(client, guildId, searchTerms, freshLockedChannelsCollection = null) {
    
    const globalLockedChannels = freshLockedChannelsCollection 
        ? Object.fromEntries(freshLockedChannelsCollection) 
        : loadLockedChannelsSafe(); 
    
    const lockedList = [];
    const pokemonCounts = {};
    const lowerSearchTerms = searchTerms.map(t => t.toLowerCase());

    for (const channelId in globalLockedChannels) {
        if (!globalLockedChannels.hasOwnProperty(channelId)) continue; 
        
        const item = globalLockedChannels[channelId];
        const channel = client.channels.cache.get(channelId); 
        
        if (!channel || channel.guild.id !== guildId || !item || !item.pokemon) continue;
        
        const lockedPokemonName = item.pokemon.toLowerCase();

        let matched = false;
        for (const term of lowerSearchTerms) {
            if (lockedPokemonName.includes(term)) {
                item.id = channelId; 
                item.channelName = channel.name; 
                lockedList.push(item);
                pokemonCounts[lockedPokemonName] = (pokemonCounts[lockedPokemonName] || 0) + 1;
                matched = true;
                break; 
            }
        }
    }
    return { lockedList, pokemonCounts };
}
//==================================================

//=====generateListOutput=====
function generateListOutput(client, guildId, state, freshLockedChannelsCollection = null) {
    
    const { lockedList, pokemonCounts } = getLockedChannelsInGuild(client, guildId, state.searchPokemonNames, freshLockedChannelsCollection);
    
    const totalPages = Math.ceil(lockedList.length / ITEMS_PER_PAGE);
    
    let newPage = state.currentPage;
    if (newPage >= totalPages && totalPages > 0) {
        newPage = totalPages - 1;
    } else if (totalPages === 0) {
        newPage = 0; 
    }

    state.lockedList = lockedList;
    state.pokemonCounts = pokemonCounts;
    state.totalPages = totalPages;
    state.currentPage = newPage;
    
    const start = state.currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const currentItems = lockedList.slice(start, end);
    const summary = getCountSummary(state.searchPokemonNames, state.pokemonCounts);
    
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🔍 Bloqueos locales coincidentes (${lockedList.length} Canales)`) 
        .setDescription(
            lockedList.length === 0 
                ? `*Coincidencias por Pokémon:* ${summary}\n\nNo hay canales bloqueados que coincidan con la búsqueda.`
                : `*Coincidencias por Pokémon:* ${summary}\n\n` + 
                  currentItems.map((item, index) =>
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

//=====updateActiveLists=====
async function updateActiveLists(client) { 
    // CORRECCIÓN: Obtener paginationStates del objeto client
    const paginationStates = client._paginationStates;
    
    if (!paginationStates || !(paginationStates instanceof Collection)) {
         console.error("❌ Fallo en ls.updateActiveLists: client._paginationStates no es una Collection.");
         return; 
    }
    
    const messagesToUpdate = [];

    // Iteramos sobre la colección obtenida (ya no es un argumento)
    for (const [messageId, state] of paginationStates) {
        // Filtramos por el comando 'ls'
        if (state.commandName === 'ls') { 
            messagesToUpdate.push({ 
                messageId, 
                channelId: state.channelId, 
                guildId: state.guildId // El ID del servidor es necesario para generar la salida
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
            
            // Usamos el guildId que hemos guardado del estado
            const { embed, components, shouldDelete } = generateListOutput(client, guildId, state);

            paginationStates.set(messageId, state);

            if (shouldDelete) {
                await message.delete().catch(() => {});
                paginationStates.delete(messageId);
            } else {
                await message.edit({ embeds: [embed], components: components }).catch(console.error);
            }
        } catch (error) {
            console.error(`Error al actualizar mensaje ls (${messageId}):`, error);
            paginationStates.delete(messageId);
        }
    }
}
//==================================================

module.exports = {
    name: 'ls',
    description: 'Busca canales bloqueados por un Pokémon específico en este servidor.',
    aliases: ['listspawn', 'sl'],
    
    //=====execute=====
    async execute(client, message, args, { paginationStates }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return message.reply({ content: '❌ Se requieren permisos para gestionar canales para usar este comando.', flags: 64 });
        }

        const searchTerm = args.join(' ').trim();
        if (!searchTerm) {
            return message.reply('❌ Debes especificar un nombre de Pokémon o una lista de nombres separados por comas. Ejemplo: `!ls rayquaza, kyogre`');
        }

        const searchTerms = searchTerm.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (searchTerms.length === 0) {
            return message.reply('❌ Debes especificar un nombre de Pokémon.');
        }

        const initialState = {
            commandName: 'ls',
            searchPokemonNames: searchTerms, 
            currentPage: 0,
            itemsPerPage: ITEMS_PER_PAGE,
            messageAuthorId: message.author.id, 
            customPrefix: 'ls',
            guildId: message.guild.id, 
            channelId: message.channel.id, 
            timestamp: Date.now()
        };

        const { embed, components, shouldDelete } = generateListOutput(client, message.guild.id, initialState);
        
        if (shouldDelete) {
            return message.reply(`🔍 No se encontraron canales bloqueados en este servidor para: **${searchTerms.join(', ')}**`);
        }

        const reply = await message.reply({ embeds: [embed], components: components });

        paginationStates.set(reply.id, initialState);
    },
    //==================================================

    //=====handlePagination=====
    async handlePagination(interaction, state, dependencies) {
        
        const { paginationStates, lockedChannels, isInternalUpdate } = dependencies;
        
        await interaction.deferUpdate().catch(() => {});
        
        if (interaction.customId.includes(`${state.customPrefix}_close_list`)) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }

        let newPage = state.currentPage;
        if (!isInternalUpdate) {
            if (interaction.customId === `${state.customPrefix}_prev_page` && state.currentPage > 0) {
                newPage = state.currentPage - 1;
            } else if (interaction.customId === `${state.customPrefix}_next_page` && state.currentPage < state.totalPages - 1) {
                newPage = state.currentPage + 1;
            } else {
                return; 
            }
            
            if (newPage === state.currentPage) return;
            state.currentPage = newPage;
        }

        const freshCollection = isInternalUpdate ? lockedChannels : null;
        
        const { embed, components, shouldDelete } = generateListOutput(
            interaction.client, 
            interaction.guild.id, 
            state, 
            freshCollection 
        );

        if (shouldDelete) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => {});
        }

        paginationStates.set(interaction.message.id, state);
        
        await interaction.message.edit({ 
            embeds: [embed], 
            components: components
        }).catch(console.error);
    },
    //==================================================
    
    //=====updateActiveListsExport=====
    updateActiveLists: updateActiveLists
    //==================================================
};
