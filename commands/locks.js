const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle      
} = require('discord.js');

// === FUNCIÓN CLAVE: CREACIÓN DE BOTONES (Propia de locks.js) ===
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    // Mostrar botones de navegación solo si hay más de una página
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
                .setCustomId('page_info_locks_disabled') 
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
    // 4. Botón Cerrar (Siempre se añade)
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${customPrefix}close_list`)
            .setLabel('❌')
            .setStyle(ButtonStyle.Danger)
    );
    
    return row;
}

module.exports = {
    name: 'locks', // Nombre del comando: !locks
    description: 'Muestra los canales bloqueados SOLO en este servidor.',
    // 🔑 Se elimina generatePaginationButtons
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        // Solo administradores pueden usar este comando
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ ¡No tienes los permisos para usar este comando!');
        }

        try {
            // Filtrar solo canales que existen en el Gremio/Servidor actual
            const lockedList = Array.from(lockedChannels.entries())
                .map(([id, data]) => {
                    // Busca el canal usando el caché del Gremio actual (message.guild.channels.cache)
                    const channel = message.guild.channels.cache.get(id); 
                    return channel ? {
                        id,
                        channelName: channel.name,
                        pokemon: data.pokemon || 'Desconocido',
                        type: data.type === 'private' ? 'Privado' : 'Público'
                    } : null;
                })
                .filter(item => item !== null) // Eliminar los canales que no pertenecen a este servidor
                .sort((a, b) => a.pokemon.localeCompare(b.pokemon));

            if (lockedList.length === 0) {
                return message.reply('❌ No hay canales bloqueados actualmente en este servidor.');
            }

            const itemsPerPage = 5;
            const totalPages = Math.ceil(lockedList.length / itemsPerPage);
            const prefix = 'locks_'; // Prefijo para los botones de paginación

            const generateEmbed = (currentPage) => {
                const start = currentPage * itemsPerPage;
                const end = start + itemsPerPage;
                const currentItems = lockedList.slice(start, end);

                const embed = new EmbedBuilder()
                    .setColor(0xEE82EE) // Un color distinto, como el violeta
                    .setTitle(`📋 Canales Bloqueados Localmente (${lockedList.length})`)
                    .setFooter({ text: `Página ${currentPage + 1} de ${totalPages}` });

                embed.setDescription(
                    currentItems.length === 0 
                        ? 'No hay canales bloqueados en esta página.'
                        : currentItems.map(item => 
                            `🔒 **${item.pokemon}** (Canal #${item.channelName})\n` +
                            `• Tipo: ${item.type}\n` +
                            `• [Ir al Canal](https://discord.com/channels/${message.guild.id}/${item.id})`
                          ).join('\n\n')
                );

                return embed;
            };
            
            const initialState = { 
                currentPage: 0,
                lockedList,
                itemsPerPage,
                totalPages,
                messageAuthorId: message.author.id,
                commandName: 'locks', // Nombre del nuevo comando
                customPrefix: prefix
            };
            
            // 🔑 Lógica: Siempre se envía el ActionRow para el botón X.
            const componentsToSend = [createPaginationRow(initialState.currentPage, totalPages, prefix)];

            const reply = await message.reply({ 
                embeds: [generateEmbed(initialState.currentPage)], 
                components: componentsToSend, 
                fetchReply: true
            });

            paginationStates.set(reply.id, initialState);
        } catch (error) {
            console.error('❌ Error en comando locks:', error);
            message.reply('❌ Ocurrió un error al mostrar la lista de bloqueos del servidor.');
        }
    },
    
    // 🔑 handlePagination: Se corrige la firma y el uso de botones
    handlePagination: async (interaction, state, { paginationStates }) => {
        if (!interaction.customId.startsWith(state.customPrefix)) return;
        
        // Verificar si la interacción ha expirado 
        if (!paginationStates.has(interaction.message.id)) {
            return interaction.update({
                components: [], // Eliminar botones
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

        // Lógica de navegación
        if (interaction.customId === `${state.customPrefix}prev_page` && state.currentPage > 0) {
            state.currentPage--;
        } else if (interaction.customId === `${state.customPrefix}next_page` && state.currentPage < state.totalPages - 1) {
            state.currentPage++;
        } else {
             return interaction.deferUpdate(); 
        }

        const start = state.currentPage * state.itemsPerPage;
        const end = start + state.itemsPerPage;
        const currentItems = state.lockedList.slice(start, end);

        const embed = new EmbedBuilder()
            .setColor(0xEE82EE)
            .setTitle(`📋 Canales Bloqueados Localmente (${state.lockedList.length})`)
            .setDescription(
                currentItems.map(item => 
                    `🔒 **${item.pokemon}** (Canal #${item.channelName})\n` +
                    `• Tipo: ${item.type}\n` +
                    `• [Ir al Canal](https://discord.com/channels/${interaction.guild.id}/${item.id})`
                ).join('\n\n')
            )
            .setFooter({ text: `Página ${state.currentPage + 1} de ${state.totalPages}` });

        await interaction.update({ 
            embeds: [embed], 
            // 🔑 Usamos la función local robusta para actualizar los botones
            components: [createPaginationRow(state.currentPage, state.totalPages, state.customPrefix)] 
        }).catch(console.error);
    }
};