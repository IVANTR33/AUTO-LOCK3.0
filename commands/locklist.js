const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle      
} = require('discord.js');

// === FUNCIÓN CLAVE: CREACIÓN DE BOTONES (Propia de locklist.js) ===
function createPaginationRow(currentPage, totalPages, customPrefix) {
    const row = new ActionRowBuilder();

    // Mostrar botones de navegación solo si hay más de una página
    if (totalPages > 1) {
        const isFirstPage = currentPage === 0;
        const isLastPage = currentPage === totalPages - 1;

        // 1. Botón Anterior (Prev)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_prev_page`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isFirstPage)
        );

        // 2. Botón de Información de Página (Pág X/Y)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('page_info_locklist_disabled') 
                .setLabel(`Pág ${currentPage + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );

        // 3. Botón Siguiente (Next)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${customPrefix}_next_page`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isLastPage)
        );
    } 
    // 4. Botón Cerrar (Siempre se añade)
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`${customPrefix}_close_list`)
            .setLabel('❌')
            .setStyle(ButtonStyle.Danger)
    );
    
    return row;
}

module.exports = {
    name: 'locklist',
    description: 'Muestra los canales bloqueados.',
    // 🔑 Se elimina generatePaginationButtons
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ ¡No tienes los permisos para usar este comando!');
        }

        try {
            const lockedList = Array.from(lockedChannels.entries())
                .map(([id, data]) => {
                    const channel = client.channels.cache.get(id);
                    return channel ? {
                        id,
                        channelName: channel.name,
                        pokemon: data.pokemon || 'Desconocido',
                        type: data.type === 'private' ? 'Privado' : 'Público'
                    } : null;
                })
                .filter(item => item !== null)
                .sort((a, b) => a.pokemon.localeCompare(b.pokemon));

            if (lockedList.length === 0) {
                return message.reply('No hay canales bloqueados actualmente.');
            }

            const itemsPerPage = 5;
            const totalPages = Math.ceil(lockedList.length / itemsPerPage);

            const generateEmbed = (currentPage) => {
                const start = currentPage * itemsPerPage;
                const end = start + itemsPerPage;
                const currentItems = lockedList.slice(start, end);

                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(`📋 Canales Bloqueados (${lockedList.length})`)
                    .setDescription(
                        currentItems.map(item => 
                            `🔒 **${item.pokemon}** (Canal #${item.channelName})\n` +
                            `• Tipo: ${item.type}\n` +
                            `• [Ir al Canal](https://discord.com/channels/${message.guild.id}/${item.id})`
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
                commandName: 'locklist', 
                customPrefix: 'locklist',
                messageId: null, // Se llenará al enviar
                timestamp: Date.now()
            };

            // 🔑 Lógica: Siempre se envía el ActionRow para el botón X.
            const componentsToSend = [createPaginationRow(initialState.currentPage, totalPages, 'locklist')];

            const reply = await message.reply({ 
                embeds: [generateEmbed(initialState.currentPage)], 
                components: componentsToSend, 
                fetchReply: true
            });

            initialState.messageId = reply.id;
            paginationStates.set(reply.id, initialState);
        } catch (error) {
            console.error('❌ Error en comando locklist:', error);
            message.reply('❌ Ocurrió un error al mostrar la lista de bloqueos.');
        }
    },
    
    // 🔑 handlePagination: Se corrige la firma y el uso de botones
    async handlePagination(interaction, state, { paginationStates }) {
        if (!interaction.isButton()) return;
        
        // Verificar expiración (Mismo código)
        if (!paginationStates.has(interaction.message.id)) {
            return interaction.update({
                components: [], 
                content: '⌛ Esta interacción ha expirado (1 minuto)',
                embeds: []
            }).catch(() => {});
        }

        // Verificar autor (Mismo código)
        if (interaction.user.id !== state.messageAuthorId) {
            return interaction.reply({ 
                content: '❌ Solo el autor del comando puede interactuar.', 
                ephemeral: true 
            });
        }

        // Manejar cierre (Mismo código)
        if (interaction.customId === `${state.customPrefix}_close_list`) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => interaction.update({ components: [] }));
        }

        // Lógica de navegación
        let newPage = state.currentPage;
        if (interaction.customId === `${state.customPrefix}_prev_page`) {
            newPage = Math.max(0, state.currentPage - 1);
        } else if (interaction.customId === `${state.customPrefix}_next_page`) {
            newPage = Math.min(state.totalPages - 1, state.currentPage + 1);
        } else {
             // Ignorar interacciones que no sean de navegación o cierre (como el botón de "Pág X/Y")
            return interaction.deferUpdate(); 
        }

        // Si no hubo cambio (ej. click en Prev en pág 1), no hacer nada
        if (newPage === state.currentPage) return interaction.deferUpdate();
        
        state.currentPage = newPage;
        paginationStates.set(interaction.message.id, state);

        // Generar nuevo Embed
        const start = state.currentPage * state.itemsPerPage;
        const end = start + state.itemsPerPage;
        const currentItems = state.lockedList.slice(start, end);

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`📋 Canales Bloqueados (${state.lockedList.length})`)
            .setDescription(
                currentItems.map(item => 
                    `🔒 **${item.pokemon}** (Canal #${item.channelName})\n` +
                    `• Tipo: ${item.type}\n` +
                    `• [Ir al Canal](https://discord.com/channels/${interaction.guild.id}/${item.id})`
                ).join('\n\n')
            )
            .setFooter({ text: `Página ${state.currentPage + 1} de ${state.totalPages}` });
        
        // Reconstrucción de botones usando la función local
        const combinedRow = createPaginationRow(state.currentPage, state.totalPages, state.customPrefix);
        
        await interaction.update({ 
            embeds: [embed], 
            components: [combinedRow] 
        });
    }
};