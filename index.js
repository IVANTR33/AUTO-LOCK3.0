const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  Collection,
  EmbedBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const commands = { prefixCommands: {} };

// Cargar comandos desde la carpeta commands
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(__dirname, 'commands', file));
    if (command.name) {
        commands.prefixCommands[command.name] = command;
        if (command.aliases) {
            command.aliases.forEach(alias => {
                commands.prefixCommands[alias] = command;
            });
        }
    }
}

// ========== CONFIGURACIÓN ==========
const SPAWN_ROLE_NAME = "Acceso Spawns";
const PREFIX = '!';
const requiredEnvVars = ['DISCORD_TOKEN', 'POKE_NAME_ID', 'POKETWO_ID'];
const missingVars = requiredEnvVars.filter(env => !process.env[env]);

if (missingVars.length > 0) {
  console.error(`❌ Faltan variables de entorno: ${missingVars.join(', ')}`);
  process.exit(1);
}

// ========== CONFIGURACIÓN PERSISTENTE ==========
const configPath = path.join(__dirname, 'config.json');
let config = {
  mentionRoles: {}, // Objeto para almacenar roles por servidor
  logChannel: null
};

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log('✅ Archivo de configuración creado');
    }
  } catch (error) {
    console.error("❌ Error al cargar configuración:", error);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("❌ Error al guardar configuración:", error);
  }
}

loadConfig();

// ========== CANALES BLOQUEADOS ==========
const lockedChannelsPath = path.join(__dirname, 'locked_channels.json');

function loadLockedChannels() {
  try {
    if (fs.existsSync(lockedChannelsPath)) {
      const data = JSON.parse(fs.readFileSync(lockedChannelsPath, 'utf-8'));
      return new Collection(Object.entries(data));
    }
    console.log('✅ No hay canales bloqueados registrados');
    return new Collection();
  } catch (error) {
    console.error("❌ Error al cargar canales bloqueados:", error);
    return new Collection();
  }
}

function saveLockedChannels(lockedChannels) {
  try {
    const data = Object.fromEntries(lockedChannels);
    fs.writeFileSync(lockedChannelsPath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("❌ Error al guardar canales bloqueados:", error);
  }
}

// ========== CLIENTE ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions
  ]
});

// ========== LISTAS BLANCAS ==========
const whitelistPublicPath = path.join(__dirname, 'whitelist_public.json');
const whitelistPrivatePath = path.join(__dirname, 'whitelist_private.json');
let whitelistPublic = new Set();
let whitelistPrivate = new Set();
const lockedChannels = loadLockedChannels();
const cooldowns = new Collection();
const lockMessages = new Collection(); // Almacena IDs de mensajes de bloqueo
const paginationStates = new Collection(); // Para manejar la paginación

function loadWhitelists() {
  try {
    whitelistPublic.clear();
    whitelistPrivate.clear();

    if (fs.existsSync(whitelistPublicPath)) {
      const publicData = JSON.parse(fs.readFileSync(whitelistPublicPath, 'utf-8'));
      publicData.forEach(pokemon => {
        whitelistPublic.add(pokemon.toLowerCase().trim());
      });
    } else {
      fs.writeFileSync(whitelistPublicPath, '[]');
      console.log('✅ Archivo de lista pública creado');
    }

    if (fs.existsSync(whitelistPrivatePath)) {
      const privateData = JSON.parse(fs.readFileSync(whitelistPrivatePath, 'utf-8'));
      privateData.forEach(pokemon => {
        whitelistPrivate.add(pokemon.toLowerCase().trim());
      });
    } else {
      fs.writeFileSync(whitelistPrivatePath, '[]');
      console.log('✅ Archivo de lista privada creado');
    }
  } catch (error) {
    console.error("❌ Error al cargar listas:", error);
  }
}

loadWhitelists();

// ========== FUNCIONES DE BLOQUEO/DESBLOQUEO ==========
async function lockChannel(channel, hideChannel = false) {
  if (!process.env.POKETWO_ID || !/^\d{17,19}$/.test(process.env.POKETWO_ID)) {
    console.error("❌ FALLO CRÍTICO: ID de Pokétwo inválido o no configurado");
    return false;
  }

  try {
    const poketwoMember = await channel.guild.members.fetch(process.env.POKETWO_ID).catch(() => null);
    if (!poketwoMember) {
      console.error(`❌ FALLO CRÍTICO: Pokétwo no está en el servidor (ID: ${process.env.POKETWO_ID})`);
      return false;
    }

    if (!channel.permissionOverwrites.cache.has(process.env.POKETWO_ID)) {
      await channel.permissionOverwrites.create(process.env.POKETWO_ID, {
        SendMessages: null
      });
    }

    await channel.permissionOverwrites.edit(process.env.POKETWO_ID, {
      SendMessages: false
    });

    if (hideChannel) {
      const spawnRole = channel.guild.roles.cache.find(
        r => r.name.toLowerCase() === "Acceso Spawns"
      );
      if (spawnRole) {
        await channel.permissionOverwrites.edit(spawnRole.id, {
          ViewChannel: false
        });
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ FALLO en ${channel.name}: ${error.message}`);
    return false;
  }
}

async function unlockChannel(channel) {
  if (!process.env.POKETWO_ID || !/^\d{17,19}$/.test(process.env.POKETWO_ID)) {
    console.error("❌ FALLO CRÍTICO: ID de Pokétwo inválido o no configurado");
    return false;
  }

  try {
    if (channel.permissionOverwrites.cache.has(process.env.POKETWO_ID)) {
      try {
        await channel.permissionOverwrites.edit(process.env.POKETWO_ID, {
          SendMessages: true
        });
      } catch (error) {
        console.error(`❌ FALLO CRÍTICO: No se pudo restaurar Pokétwo en ${channel.name} - ${error.message}`);
        return false;
      }
    }

    const spawnRole = channel.guild.roles.cache.find(
      r => r.name.toLowerCase() === "Acceso Spawns"
    );

    if (spawnRole && channel.permissionOverwrites.cache.has(spawnRole.id)) {
      try {
        await channel.permissionOverwrites.edit(spawnRole.id, {
          ViewChannel: true
        });
      } catch (error) {
        console.error(`❌ FALLO CRÍTICO: No se pudo restaurar visibilidad en ${channel.name} - ${error.message}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ FALLO GLOBAL en unlockChannel (${channel.name}): ${error.message}`);
    return false;
  }
}

// Función para generar botones de paginación
function generatePaginationButtons(currentPage, totalPages, prefix) {
  const row = new ActionRowBuilder();

  // Botón Anterior
  if (currentPage > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}prev_page`)
        .setLabel('◀️')
        .setStyle(ButtonStyle.Primary)
    );
  }

  // Botón Cerrar (siempre aparece)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}close_list`)
      .setLabel('❌')
      .setStyle(ButtonStyle.Danger)
  );

  // Botón Siguiente
  if (currentPage < totalPages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}next_page`)
        .setLabel('▶️')
        .setStyle(ButtonStyle.Primary)
    );
  }

  return row;
}
  

// ========== EVENTO LISTO ==========
client.on('clientReady', async () => {
  // Calcular métricas
  const totalGuilds = client.guilds.cache.size;
  const numberedChannels = client.guilds.cache.reduce((acc, guild) => {
    return acc + guild.channels.cache.filter(ch => 
      /^\d{1,3}$/.test(ch.name) && parseInt(ch.name) <= 450
    ).size;
  }, 0);
  const freeChannels = numberedChannels - lockedChannels.size;

  // Diseño del bloque de logs (versión simplificada)
  console.log(`
╔════════════════════════════════════════════╗
║                                            
║   ✅ ${client.user.tag} En Línea 🟢         
║                                            
╠════════════════════════════════════════════╣
║                                            
║   🗄️  Servidores: ${totalGuilds.toString().padEnd(8)} 
║   📊  Canales totales: ${numberedChannels.toString().padEnd(8)} 
║   🟢  Canales libres: ${freeChannels.toString().padEnd(9)} 
║   🚫  Canales bloqueados: ${lockedChannels.size.toString().padEnd(5)} 
║                                            
╠════════════════════════════════════════════╣
║                                            
║   📋  Lista pública: ${whitelistPublic.size.toString().padEnd(5)} Nombres 
║   🔒  Lista privada: ${whitelistPrivate.size.toString().padEnd(5)} Nombres 
║                                            
╚════════════════════════════════════════════╝
  `);
});
 


// ========== MANEJO DE COMANDOS ==========
client.on('messageCreate', async (message) => {
  // Comandos con prefijo
  if (message.content.startsWith(PREFIX)) {
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    try {
      const command = commands.prefixCommands[commandName];
      
      if (command) {
        await command.execute(client, message, args, {
          whitelistPublic,
          whitelistPrivate,
          whitelistPublicPath,
          whitelistPrivatePath,
          loadWhitelists,
          lockedChannels,
          lockMessages,
          config,
          mentionRole: config.mentionRole,
          logChannel: config.logChannel,
          SPAWN_ROLE_NAME,
          saveConfig,
          lockChannel,
          unlockChannel,
          saveLockedChannels,
          paginationStates,
          generatePaginationButtons
        });
      }
    } catch (error) {
      console.error(`❌ Error ejecutando comando ${commandName}:`, error);
      message.reply('❌ Ocurrió un error al ejecutar el comando').catch(console.error);
    }
    return;
  }

  // Detección de Pokémon
  if (
    message.author.id !== process.env.POKE_NAME_ID ||
    !/^\d{1,3}$/.test(message.channel.name) ||
    parseInt(message.channel.name) > 450
  ) return;

  const content = message.content.toLowerCase();
  if (content.includes("is not a valid pokemon name") || 
      content.includes("you are already collecting this pokemon")) {
    return;
  }

  const now = Date.now();
  const cooldownTime = 30000;
  const cooldownKey = `lock_${message.channel.id}`;

  if (cooldowns.has(cooldownKey)) {
    const expirationTime = cooldowns.get(cooldownKey) + cooldownTime;
    if (now < expirationTime) return;
  }

  // Primero verificar lista privada
  const detectedPrivate = [...whitelistPrivate].find(pokemon => {
    const regex = new RegExp(`\\b${pokemon}\\b`, 'i');
    return regex.test(content);
  });

  if (detectedPrivate) {
    try {
      const existingMessages = await message.channel.messages.fetch({ limit: 5 });
      const hasWarning = existingMessages.some(m =>
        m.author.id === client.user.id && m.components.length > 0
      );

      if (!hasWarning) {
        cooldowns.set(cooldownKey, now);
        setTimeout(() => cooldowns.delete(cooldownKey), cooldownTime);

        await lockChannel(message.channel, true);
        lockedChannels.set(message.channel.id, { type: 'private', pokemon: detectedPrivate });
        saveLockedChannels(lockedChannels);

        const spawnRole = message.guild.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);
        if (spawnRole) {
          await message.channel.permissionOverwrites.edit(spawnRole.id, {
            ViewChannel: false
          });
        }

        const button = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`unlock_${message.channel.id}`)
            .setLabel('🔒 BLOQUEADO')
            .setStyle(ButtonStyle.Danger)
        );

        const mentionRoleId = config.mentionRoles[message.guild.id];
        const mention = mentionRoleId ? ` <@&${mentionRoleId}>` : '';
        const lockMessage = await message.channel.send({
          content: `🧭 **${detectedPrivate}** **𝘿𝙚𝙩𝙚𝙘𝙩𝙖𝙙𝙤!**${mention}`,
          components: [button]
        });

        lockMessages.set(message.channel.id, {
          messageId: lockMessage.id,
          channelId: message.channel.id,
          timestamp: Date.now()
        });

        if (config.logChannel) {
          const logChannel = client.channels.cache.get(config.logChannel);
          if (logChannel) {
            logChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xFF0000)
                  .setTitle('🔒 Bloqueo Privado')
                  .setDescription(`**Canal:** ${message.channel.name}\n**Pokémon:** ${detectedPrivate}`)
                  .setTimestamp()
              ]
            }).catch(console.error);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error al bloquear (privado):', error);
    }
    return;
  }

  // Verificar lista pública
  const detectedPublic = [...whitelistPublic].find(pokemon => {
    const regex = new RegExp(`\\b${pokemon}\\b`, 'i');
    return regex.test(content);
  });

  if (detectedPublic) {
    try {
      const existingMessages = await message.channel.messages.fetch({ limit: 5 });
      const hasWarning = existingMessages.some(m =>
        m.author.id === client.user.id && m.components.length > 0
      );

      if (!hasWarning) {
        cooldowns.set(cooldownKey, now);
        setTimeout(() => cooldowns.delete(cooldownKey), cooldownTime);

        await lockChannel(message.channel, false);
        lockedChannels.set(message.channel.id, { type: 'public', pokemon: detectedPublic });
        saveLockedChannels(lockedChannels);

        const button = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`unlock_${message.channel.id}`)
            .setLabel('🔒 BLOQUEADO')
            .setStyle(ButtonStyle.Danger)
        );

        const mentionRoleId = config.mentionRoles[message.guild.id];
        const mention = mentionRoleId ? ` <@&${mentionRoleId}>` : '';
        const lockMessage = await message.channel.send({
          content: `${detectedPublic} detectado ${mention}`,
          components: [button]
        });

        lockMessages.set(message.channel.id, {
          messageId: lockMessage.id,
          channelId: message.channel.id,
          timestamp: Date.now()
        });

        if (config.logChannel) {
          const logChannel = client.channels.cache.get(config.logChannel);
          if (logChannel) {
            logChannel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xFFA500)
                  .setTitle('🔒 Bloqueo Público')
                  .setDescription(`**Canal:** ${message.channel.name}\n**Pokémon:** ${detectedPublic}`)
                  .setTimestamp()
              ]
            }).catch(console.error);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error al bloquear (público):', error);
    }
  }
});

// ========== INTERACCIONES ==========
  client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // === BOTONES DE DESBLOQUEO ===
  if (interaction.customId.startsWith('unlock_')) {
    try {
      await interaction.deferUpdate();

      const channelId = interaction.customId.split('_')[1];
      const channel = await client.channels.fetch(channelId);
      const lockInfo = lockedChannels.get(channelId);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const spawnRole = member.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);

      if (lockInfo?.type === 'private' && !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.followUp({
          content: '❌ Solo staff puede desbloquear canales privados',
          ephemeral: true
        });
      }

      if (!spawnRole && !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.followUp({
          content: `❌ Necesitas el rol "${SPAWN_ROLE_NAME}" o permisos de staff`,
          ephemeral: true
        });
      }

      // 🛑 CORRECCIÓN: Borra el mensaje de interacción (que es el mensaje de bloqueo).
      // Eliminamos el bloque que busca y borra el mensaje de bloqueo por ID,
      // ya que interaction.message.delete() borra el mismo mensaje.
      try {
        await interaction.message.delete();
        lockMessages.delete(channelId); // Limpiar el registro después del borrado
      } catch (error) {
        console.error('❌ Error al borrar mensaje de bloqueo/interacción:', error);
      }
      // 🛑 FIN DE CORRECCIÓN


      const unlockSuccess = await unlockChannel(channel);
      if (!unlockSuccess) {
        return interaction.followUp({
          content: '❌ Error al desbloquear el canal',
          ephemeral: true
        });
      }

      const spawnRoleToUpdate = interaction.guild.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);
      if (spawnRoleToUpdate) {
        try {
          await channel.permissionOverwrites.edit(spawnRoleToUpdate.id, {
            ViewChannel: true
          });
        } catch (error) {
          console.error('❌ Error al actualizar permisos del rol:', error);
        }
      }

      lockedChannels.delete(channelId);
      saveLockedChannels(lockedChannels);

      await channel.send({
        content: `✅ Canal desbloqueado por <@${interaction.user.id}>`,
        allowedMentions: { users: [] }
      });

if (config.logChannel) {
  const logChannel = client.channels.cache.get(config.logChannel);
  if (logChannel) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('🔓 Desbloqueo Manual')
          .setDescription([
            `**Pokémon:** ${lockInfo?.pokemon || 'Desconocido'}`,
            `**Canal:** ${channel}`,
            `**Usuario:** ${interaction.user.tag}`,
            `[Ir al mensaje](${interaction.message.url})`
          ].join('\n'))
          .setFooter({ text: `ID Usuario: ${interaction.user.id}` })
          .setTimestamp()
      ]
    }).catch(console.error);
  }
}   
    } catch (error) {
      console.error('❌ Error en interacción de desbloqueo:', error);
      interaction.followUp({
        content: '❌ Ocurrió un error al desbloquear',
        ephemeral: true
      });
    }
  }

 // === BOTONES DE PAGINACIÓN (CUALQUIER COMANDO) ===
else if (
    interaction.customId.includes('_prev_page') ||
    interaction.customId.includes('_next_page') ||
    interaction.customId.includes('_close_list')
) {
    const state = paginationStates.get(interaction.message.id);
    if (!state) return;

    if (state.messageAuthorId !== interaction.user.id) {
        return interaction.reply({
            content: '❌ Solo el autor del comando puede interactuar con esta paginación',
            ephemeral: true
        });
    }

    // Detectar el comando que creó el mensaje
    const commandName = state.commandName;
    const command = commands.prefixCommands[commandName];

    if (command && command.handlePagination) {
        await command.handlePagination(interaction, state, generatePaginationButtons, paginationStates);
    }
}  
});

// ========== MANEJO DE ERRORES ==========
process.on('unhandledRejection', error => {
  console.error('❌ Rechazo no controlado:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Excepción no detectada:', error);
  process.exit(1);
});

// ========== INICIAR BOT ==========
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ Error al iniciar sesión:', error);
  process.exit(1);
});