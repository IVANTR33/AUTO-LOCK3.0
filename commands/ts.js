const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle      
} = require('discord.js');

// === FUNCIÓN CLAVE: CREACIÓN DE BOTONES (Propia de ts.js) ===
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
                .setCustomId('page_info_ts_disabled') 
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
    name: 'ts',
    description: 'Muestra todos los Pokémon con canales bloqueados',
    // 🔑 Se elimina generatePaginationButtons
    async execute(client, message, args, { lockedChannels, paginationStates }) { 
        // 1. Contar Pokémon bloqueados
        const pokemonCounts = {};
        Array.from(lockedChannels.values()).forEach(({ pokemon }) => {
            pokemonCounts[pokemon] = (pokemonCounts[pokemon] || 0) + 1;
        });

        // 2. Ordenar por cantidad
        const sortedPokemon = Object.entries(pokemonCounts).sort((a, b) => b[1] - a[1]);

        if (sortedPokemon.length === 0) {
            return message.reply('❌ No hay Pokémon bloqueados actualmente.');
        }

        // 3. Configuración de paginación
        const itemsPerPage = 10;
        const totalPages = Math.ceil(sortedPokemon.length / itemsPerPage);
        const currentPage = 0;
        const prefix = 'ts_';

        // 4. Crear embed
        const embed = new EmbedBuilder()
            .setTitle('🏆 Ranking de Pokémon Bloqueados')
            .setColor(0xFFA500)
            .setFooter({ text: `Página ${currentPage + 1}/${totalPages}` });

        // 5. Añadir campos
        const startIdx = currentPage * itemsPerPage;
        sortedPokemon.slice(startIdx, startIdx + itemsPerPage).forEach(([pokemon, count], i) => {
            const position = startIdx + i + 1;
            let emoji;
            
            if (position === 1) emoji = '👑';
            else if (position === 2) emoji = '🥈';
            else if (position === 3) emoji = '🥉';
            else if (position <= 10) emoji = '✳️';
            else emoji = '🔶';

            embed.addFields({
                name: `${emoji} \`#${position}\` **${this.formatName(pokemon)}**`,
                value: `🔒 **[ ${count} ] Spawns**\n================`,
                inline: false
            });
        });

        // 6. Enviar mensaje con botones
        // 🔑 Lógica: Siempre se envía el ActionRow para el botón X.
        const componentsToSend = [createPaginationRow(currentPage, totalPages, prefix)];
        
        const msg = await message.reply({ 
            embeds: [embed], 
            components: componentsToSend, 
            fetchReply: true
        });

        // 7. Guardar estado (Mismo código)
        const state = {
            currentPage,
            totalPages,
            sortedPokemon,
            itemsPerPage,
            messageAuthorId: message.author.id,
            commandName: this.name,
            customPrefix: prefix,
            messageId: msg.id,
            timestamp: Date.now()
        };
        paginationStates.set(msg.id, state);

        // 8. Eliminar completamente los botones después de 1 minuto (Mismo código)
        setTimeout(async () => {
            if (!paginationStates.has(msg.id)) return;
            
            try {
                await msg.edit({ components: [] });
                paginationStates.delete(msg.id);
            } catch (error) {
                console.error('Error al eliminar botones:', error);
                paginationStates.delete(msg.id);
            }
        }, 60000);
    },

    // 🔑 handlePagination: Se corrige la firma y el uso de botones
    async handlePagination(interaction, state, { paginationStates }) {
        if (!interaction.isButton()) return;

        // Verificar si la interacción ha expirado 
        if (!paginationStates.has(interaction.message.id)) {
            return interaction.update({
                components: [], 
                content: '⌛ Esta interacción ha expirado (1 minuto)',
                embeds: []
            }).catch(() => {});
        }

        // Verificar autor
        if (interaction.user.id !== state.messageAuthorId) {
            return interaction.reply({ 
                content: '❌ Solo el autor del comando puede interactuar.', 
                ephemeral: true 
            });
        }

        // Manejar cierre
        if (interaction.customId === `${state.customPrefix}close_list`) {
            paginationStates.delete(interaction.message.id);
            return interaction.message.delete().catch(() => 
                interaction.update({ components: [] })
            );
        }

        // Actualizar página
        let newPage = state.currentPage;
        if (interaction.customId === `${state.customPrefix}prev_page`) {
            newPage = Math.max(0, state.currentPage - 1);
        } else if (interaction.customId === `${state.customPrefix}next_page`) {
            newPage = Math.min(state.totalPages - 1, state.currentPage + 1);
        } else {
             return interaction.deferUpdate(); 
        }

        // Si no hubo cambio, no hacer nada
        if (newPage === state.currentPage) return interaction.deferUpdate();

        // Actualizar estado
        state.currentPage = newPage;
        paginationStates.set(interaction.message.id, state);

        // Actualizar embed
        const newEmbed = new EmbedBuilder()
            .setTitle('🏆 Ranking de Pokémon Bloqueados')
            .setColor(0xFFA500)
            .setFooter({ text: `Página ${state.currentPage + 1}/${state.totalPages}` });

        const startIdx = state.currentPage * state.itemsPerPage;
        state.sortedPokemon.slice(startIdx, startIdx + state.itemsPerPage).forEach(([pokemon, count], i) => {
            const position = startIdx + i + 1;
            let emoji;
            
            if (position === 1) emoji = '👑';
            else if (position === 2) emoji = '🥈';
            else if (position === 3) emoji = '🥉';
            else if (position <= 10) emoji = '✳️';
            else emoji = '🔶';

            newEmbed.addFields({
                name: `${emoji} \`#${position}\` **${this.formatName(pokemon)}**`,
                value: `🔒 **[ ${count} ] Spawns**\n================`,
                inline: false
            });
        });

        // Actualizar mensaje
        await interaction.update({ 
            embeds: [newEmbed],
            // 🔑 Usamos la función local de creación de botones
            components: [createPaginationRow(state.currentPage, state.totalPages, state.customPrefix)] 
        }).catch(console.error);
    },

    formatName(name) { 
        return name.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
};