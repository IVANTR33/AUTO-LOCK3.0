const { 
    EmbedBuilder, 
    PermissionsBitField, 
    ActionRowBuilder, 
    ButtonBuilder,   
    ButtonStyle,
    Collection // 🔑 Se asegura la importación si se usa en execute
} = require('discord.js');
const os = require('os');

// === FUNCIÓN AUXILIAR: CREACIÓN DE BOTÓN CERRAR ===
// La ID del botón debe terminar en '_close_list' para que index.js la reconozca.
function createCloseRow(customId) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            // 🔑 La ID debe ser el prefijo + el sufijo paginado para ser ruteado por index.js
            .setCustomId(customId) 
            .setLabel('❌ Cerrar')
            .setStyle(ButtonStyle.Danger)
    );
    return row;
}
// ===============================================

module.exports = {
  name: 'stats',
  description: 'Muestra estadísticas avanzadas del bot',
  async execute(client, message, args, { 
    lockedChannels,
    config,
    SPAWN_ROLE_NAME,
    logChannel,
    paginationStates // 🔑 Necesario para guardar el estado del botón
  }) {
    
    

//=====================================================================
    // Mensaje de carga
    const loadingEmbed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('📊 Cargando estadísticas...')
      .setDescription('🕐 Por favor espera mientras recopilamos los datos...');
    
    const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

    // Animación de carga
    const loadingEmojis = ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'];
    let loadingInterval = setInterval(async () => {
      const currentEmoji = loadingEmojis.shift();
      loadingEmojis.push(currentEmoji);
      loadingEmbed.setDescription(`${currentEmoji} Por favor espera mientras recopilamos los datos...`);
      try {
        await loadingMessage.edit({ embeds: [loadingEmbed] });
      } catch (error) {
        clearInterval(loadingInterval);
      }
    }, 2000);

    // 1. Verificación de bots y roles
    const pokeNameBot = await message.guild.members.fetch(process.env.POKE_NAME_ID).catch(() => null);
    const poketwoBot = await message.guild.members.fetch(process.env.POKETWO_ID).catch(() => null);
    const spawnRole = message.guild.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);

    // 2. Métricas de rendimiento
    const memoryUsage = process.memoryUsage();
    const usedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const totalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const cpuUsage = process.cpuUsage().user / 1000000;

    // 3. Estadísticas globales
    const totalGuilds = client.guilds.cache.size;
    const uptime = formatUptime(process.uptime());

    // 4. Canales globales
    const allChannels = client.guilds.cache.reduce((acc, guild) => {
      const validChannels = guild.channels.cache.filter(ch => 
        /^\d{1,3}$/.test(ch.name) && parseInt(ch.name) <= 450
      );
      return {
        total: acc.total + validChannels.size,
        locked: acc.locked + Array.from(validChannels.values()).filter(
          ch => lockedChannels.has(ch.id)
        ).length
      };
    }, { total: 0, locked: 0 });

    // 5. Estadísticas del servidor actual
    const currentGuild = message.guild;
    const guildChannels = currentGuild.channels.cache.filter(ch => 
      /^\d{1,3}$/.test(ch.name) && parseInt(ch.name) <= 450
    );
    const guildLockedChannels = Array.from(guildChannels.values()).filter(
      ch => lockedChannels.has(ch.id)
    ).length;

    // 6. Configuración del servidor
    const logChannelStatus = config.logChannel 
      ? `✅ <#${config.logChannel}>` 
      : '❌ No configurado';
      
    const mentionRoleStatus = config.mentionRoles?.[message.guild.id] 
      ? `✅ <@&${config.mentionRoles[message.guild.id]}>` 
      : '❌ No configurado';
      
    // Embed final
    const statsEmbed = new EmbedBuilder()
      .setColor(0x00AE86)
      .setTitle('📊 ESTADÍSTICAS AVANZADAS')
      .addFields(
        { 
          name: '🌍 Global', 
          value: `🗄️ Servidores: **${totalGuilds}**\n⏱️ Uptime: **${uptime}**\n===================`,
          inline: true 
        },
        { 
          name: '📊 Rendimiento', 
          value: `🖥️ RAM: **${usedMB}MB/${totalMB}MB**\n⚡ CPU: **${cpuUsage.toFixed(2)}ms**\n===================`,
          inline: true 
        },
        { 
          name: '🤖 Bots', 
          value: `🏵️ <@874910942490677270>: ${pokeNameBot ? '✅' : '❌'}\n🔸 <@716390085896962058>: ${poketwoBot ? '✅' : '❌'}\n===================`,
          inline: true 
        },
        { 
          name: '⚙️ Configuración', 
          value: `👥 Rol Acceso: ${spawnRole ? '✅' : '❌ **Faltante**'}\n📝 Canal Logs: ${logChannelStatus}\n🔔 Rol Mención: ${mentionRoleStatus}\n===================`,
          inline: false 
        },
        { 
          name: '📦 Canales Globales', 
          value: `🔹 Total: **${allChannels.total}**\n🔴 Bloqueados: **${allChannels.locked}**\n🟢 Libres: **${allChannels.total - allChannels.locked}**\n===================`,
          inline: false 
        },
        { 
          name: `🏠 ${currentGuild.name}`, 
          value: `🔹 Canales: **${guildChannels.size}**\n🔴 Bloqueados: **${guildLockedChannels}**\n🟢 Libres: **${guildChannels.size - guildLockedChannels}**\n===================`,
          inline: false 
        }
      )
      .setFooter({ 
        text: `Solicitado por ${message.author.tag}`, 
        iconURL: message.author.displayAvatarURL() 
      });

    // Detener animación y mostrar resultados
    clearInterval(loadingInterval);
    await loadingMessage.delete().catch(() => null);
    
    const customPrefix = 'stats_';
    // 🔑 Usamos la ID: stats_close_list
    const closeButtonRow = createCloseRow(`${customPrefix}close_list`); 
    
    // 🔑 Enviamos el mensaje y guardamos la referencia
    const reply = await message.reply({ embeds: [statsEmbed], components: [closeButtonRow], fetchReply: true });

    // 🔑 GUARDAR ESTADO MÍNIMO para que index.js rutee la interacción y verifique el autor
    const state = {
        messageAuthorId: message.author.id,
        commandName: 'stats', // Esto permite a index.js llamar a handlePagination
        customPrefix: customPrefix,
        timestamp: Date.now()
    };
    paginationStates.set(reply.id, state);

    // Opcional: Auto-borrado de estado y botones después de 1 minuto
    setTimeout(() => {
        if (!paginationStates.has(reply.id)) return;
        
        paginationStates.delete(reply.id);
        reply.edit({ components: [] }).catch(() => {});
    }, 60000);

    // Función para formatear tiempo
    function formatUptime(seconds) {
      const days = Math.floor(seconds / (3600 * 24));
      const hours = Math.floor((seconds % (3600 * 24)) / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      return `${days}d ${hours}h ${mins}m`;
    }
  },
  
  // 🔑 FUNCIÓN PARA MANEJAR LA INTERACCIÓN DEL BOTÓN DE CERRAR
  async handlePagination(interaction, state, { paginationStates }) {
    // Solo manejamos el botón de cerrar
    if (interaction.customId === `${state.customPrefix}close_list`) {
        paginationStates.delete(interaction.message.id);
        
        // Borrar el mensaje completo (como en los comandos paginados)
        return interaction.message.delete().catch(() => 
            // Si falla el borrado, quitamos los botones para indicar el fin de la interacción.
            interaction.update({ components: [] }).catch(() => {})
        );
    }
    
    // Para cualquier otro botón (no debería haber), deferUpdate para evitar el error de timeout.
    return interaction.deferUpdate(); 
  }
};
