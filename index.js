// index.js 
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
// Solo POKE_NAME_ID es obligatorio. El resto son opcionales.
const requiredEnvVars = ['DISCORD_TOKEN', 'POKE_NAME_ID', 'POKETWO_ID'];
const missingVars = requiredEnvVars.filter(env => !process.env[env]);

if (missingVars.length > 0) {
  console.error(`❌ Faltan variables de entorno: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Soporte para hasta 4 IDs de bot de nombres adicionales (total 5)
const ADDITIONAL_NAME_IDS = [
  process.env.POKE_NAME_ID_2,
  process.env.POKE_NAME_ID_3,
  process.env.POKE_NAME_ID_4, 
  process.env.POKE_NAME_ID_5 
];

// Lista consolidada de IDs de bots de nombres
const NAME_BOT_IDS = Array.from(new Set([
  process.env.POKE_NAME_ID,
  ...ADDITIONAL_NAME_IDS
].filter(Boolean)));

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

// ========== ESTADO DE BLOQUEO ==========
const lockStatusPath = path.join(__dirname, 'lock_status.json');
let lockStatusData = {}; // Variable global, usada para pasar a comandos

function loadLockStatus() {
  try {
    if (fs.existsSync(lockStatusPath)) {
      lockStatusData = JSON.parse(fs.readFileSync(lockStatusPath, 'utf-8'));
    } else {
      fs.writeFileSync(lockStatusPath, '{}');
      console.log('✅ Archivo de estado de bloqueo creado');
    }
  } catch (error) {
    console.error("❌ Error al cargar estado de bloqueo (index.js):", error);
  }
}

function saveLockStatus() {
  try {
    fs.writeFileSync(lockStatusPath, JSON.stringify(lockStatusData, null, 2));
  } catch (error) {
    console.error("❌ Error al guardar estado de bloqueo (index.js):", error);
  }
}

loadLockStatus();

/**
 * [FIX CACHÉ] Lee el estado de bloqueo directamente del disco, asegurando que sea la versión más reciente.
 * @returns {Object} El contenido de lock_status.json.
 */
function getLocksFromDisk() {
    try {
        if (!fs.existsSync(lockStatusPath)) return {};
        // La clave: fs.readFileSync obliga a leer el archivo más reciente del disco.
        return JSON.parse(fs.readFileSync(lockStatusPath, 'utf-8'));
    } catch (error) {
        console.error("❌ Error al obtener estado de bloqueo del disco:", error);
        return {};
    }
}

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
    fs.writeFileSync(lockedChannelsPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error("❌ Error al guardar canales bloqueados:", error);
  }
}

// ========== UTIL: extracción y normalización (MATCH EXACT) ==========

function extractPokemonName(raw, authorId) {
  if (!raw) return null;
  
  let line = String(raw).split('\n')[0].trim();
  
  const SPECIAL_BOT_ID = '854233015475109888'; // Bot de Porcentaje
  const NIDORAN_SPECIAL_ID = '874910942490677270'; // Bot que usa (F)/(M)
  
  const FEMALE_SYM = '\u2640'; // ♀
  const MALE_SYM = '\u2642'; // ♂
  const VARIATION_SELECTOR = '\uFE0F'; // ️ (para manejar emojis)

  // ----------------------------------------------------
  // PASO 0: Protección de Símbolos de Género (Nidoran) y estandarización a ♀/♂
  // Reemplazamos Nidoran♂/♀ (con o sin selector de variación) por un marcador temporal
  line = line.replace(new RegExp(`nidoran\\s*${MALE_SYM}${VARIATION_SELECTOR}?`, 'gi'), 'NIDORAN_MALE_PLACEHOLDER'); 
  line = line.replace(new RegExp(`nidoran\\s*${FEMALE_SYM}${VARIATION_SELECTOR}?`, 'gi'), 'NIDORAN_FEMALE_PLACEHOLDER');
  // ----------------------------------------------------

  // REGLA 1: Eliminar "##" al inicio (solo los dos caracteres)
  if (line.startsWith('##')) {
    line = line.substring(2).trim(); 
  }

  // REGLA 2: Bot especial (854233015475109888) - Filtrado por porcentaje/dos puntos (:)
  if (String(authorId) === SPECIAL_BOT_ID) {
    if (line.toLowerCase().startsWith('type: null:')) {
      // Caso: Type: Null: 97.478% -> Extraer 'Type: Null' (antes del segundo ':')
      const firstColonIndex = line.indexOf(':');
      const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex !== -1) {
        line = line.substring(0, secondColonIndex);
      }
    } else if (line.includes(':')) {
      // Caso general para este bot: PokemonName: 97.693% -> Extraer 'PokemonName' (antes del primer ':')
      line = line.split(':')[0];
    }
  }

  // Regla existente: Eliminar contenido después del em-dash (—)
  if (line.indexOf('—') !== -1) {
    line = line.split('—')[0].trim();
  }
  
  // NUEVA REGLA 3: Conversión de (F)/(M) a PLACEHOLDERS para bot específico (874910942490677270)
  // Esto soluciona el caso de "Nidoran (F)..." -> Nidoran NIDORAN_FEMALE_PLACEHOLDER
  if (String(authorId) === NIDORAN_SPECIAL_ID) {
    // Reemplaza (F) o (M) por el marcador. El espacio al inicio es para que separe el nombre (ej: "Nidoran (F)" -> "Nidoran NIDORAN...")
    line = line.replace(/\s*\([Ff]\)/g, ' NIDORAN_FEMALE_PLACEHOLDER');
    line = line.replace(/\s*\([Mm]\)/g, ' NIDORAN_MALE_PLACEHOLDER');
  }

  // Regla 4: Eliminar contenido dentro de corchetes 【】
  line = line.replace(/【.*?】/g, ''); 

  // Resto de la limpieza
  line = line.replace(/<a?:[^>]+>/g, ''); // Elimina emotes/emojis de Discord (ej: <:_:948990686932389979>)
  line = line.replace(/:flag_[a-z]{2}:/gi, '');
  
  // CORRECCIÓN DE SINTAXIS: Elimina los caracteres de corchete/símbolo restantes
  line = line.replace(/[\[\]〈〉❨❩⦗]/g, ''); 
  
  // Elimina contenido dentro de paréntesis ()
  // Esto es seguro ahora ya que (F) y (M) para Nidoran ya fueron reemplazados por el placeholder
  line = line.replace(/\([^)]*\)/g, ''); 
  
  line = line.replace(/\*\*/g, '');
  // Esta línea elimina el resto de símbolos/emojis
  line = line.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''); 
  
  // ----------------------------------------------------
  // PASO 5: Restauración de Símbolos de Género para Nidoran
  // Restauramos el texto temporal a la forma Nidoran♂/♀ (SIN el selector de variación)
  line = line.replace(/NIDORAN_MALE_PLACEHOLDER/g, `Nidoran${MALE_SYM}`);
  line = line.replace(/NIDORAN_FEMALE_PLACEHOLDER/g, `Nidoran${FEMALE_SYM}`);
  // ----------------------------------------------------

  line = line.replace(/\s+/g, ' ').trim();
  line = line.toLowerCase(); // Convierte todo a minúsculas para coincidencia

  return line || null;
}

function normalizeForComparison(name) {
  if (!name) return '';
  // Eliminamos el selector de variación (U+FE0F) del nombre extraído Y de la clave de bloqueo
  // para asegurar la coincidencia (e.g., "nidoran♀️" en lock_status vs "nidoran♀" extraído).
  const strippedName = String(name).replace(/\uFE0F/g, ''); 
  return strippedName.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ========== FUNCIONES DE BLOQUEO/DESBLOQUEO (sin cambios) ==========
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
        r => r.name.toLowerCase() === "acceso spawns"
      );
      if (spawnRole) {
        await channel.permissionOverwrites.edit(spawnRole.id, {
          ViewChannel: false
        });
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ FALLO en lockChannel en ${channel.name}: ${error.message}`);
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
        await channel.permissionOverwrites.delete(process.env.POKETWO_ID);
      } catch (error) {
        console.error('❌ Error al eliminar permisos de Pokétwo:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error(`❌ FALLO en unlockChannel en ${channel.name}: ${error.message}`);
    return false;
  }
}

// Inicializa cliente, channelStates, cooldowns, y lockMessages aquí (asume que ya están definidos globalmente)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
const channelStates = new Map();
const cooldowns = new Map();
const lockMessages = new Map();
const lockedChannels = loadLockedChannels();

// Se asume la existencia de generatePaginationButtons y client._paginationStates o se define
function generatePaginationButtons(state) { /* ... */ } // <<-- Función definida globalmente
client._paginationStates = client._paginationStates || new Collection();
const paginationStates = client._paginationStates;


// ===================================
// ========== EVENTO LISTO (READY) ==========
// ===================================

client.on('clientReady', async () => {
  // Asegurarse de que el bot esté en caché y disponible
  if (!client.user) return console.error("❌ Cliente no disponible en el evento ready.");
  
  // Calcular métricas
  const totalGuilds = client.guilds.cache.size;
  const numberedChannels = client.guilds.cache.reduce((acc, guild) => {
    return acc + guild.channels.cache.filter(ch => 
      /^\d{1,3}$/.test(ch.name) && parseInt(ch.name) <= 450
    ).size;
  }, 0);
  
  // 'lockedChannels' es una Collection cargada al inicio (loadLockedChannels())
  const freeChannels = numberedChannels - lockedChannels.size;

  // Diseño del bloque de logs
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
║                                            
╚════════════════════════════════════════════╝
  `);
});

// ===================================

// ========== MANEJO DE MENSAJES ==========

client.on('messageCreate', async (message) => {
  try {
    
    if (message.content && message.content.startsWith(PREFIX)) {
      const args = message.content.slice(PREFIX.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();

      try {
        if (commands.prefixCommands[commandName]) {
          await commands.prefixCommands[commandName].execute(client, message, args, {
            lockStatusData, // <- Se mantiene para comandos que lean el estado global (aunque lb.js lo carga internamente)
            saveLockStatus,
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
            paginationStates: client._paginationStates,
            generatePaginationButtons
          });
        }
      } catch (error) {
        console.error(`❌ Error ejecutando comando ${commandName}:`, error);
        message.reply('❌ Ocurrió un error al ejecutar el comando').catch(console.error);
      }
      return;
    }

    
    if (!/^\d{1,3}$/.test(message.channel.name) || parseInt(message.channel.name) > 450) return;

    const now = Date.now();

    
    if (message.author.id === process.env.POKETWO_ID) {
      
      const isSpawn = (message.content && message.content.toLowerCase().includes('a wild pokémon has appeared')) ||
                      (message.embeds && message.embeds.length > 0 && (message.embeds[0].image || message.embeds[0].title || message.embeds[0].description));
      if (isSpawn) {
        
        channelStates.set(message.channel.id, { waiting: true, ts: now });
        
        setTimeout(() => {
          const s = channelStates.get(message.channel.id);
          if (s && s.waiting && Date.now() - s.ts >= 11000) {
            channelStates.delete(message.channel.id);
          }
        }, 12000).unref?.();
      }
      return;
    }

    
    if (NAME_BOT_IDS.includes(message.author.id)) {
      const state = channelStates.get(message.channel.id);
      
      // [LOG-NB] 1: Bot de Nombres detectado
      console.log(`[LOG-NB] Mensaje de Name Bot detectado en #${message.channel.name}. Estado de espera (waiting): ${state?.waiting ? 'true' : 'false'}`);
      
      const shouldTry = (state && state.waiting) || true;

      if (!shouldTry) return;

      
      const rawContent = message.content || '';
      
      // [LOG-NB] 2: Contenido crudo
      console.log(`[LOG-NB] Contenido crudo: ${rawContent}`);

     
      const lower = rawContent.toLowerCase();
      if (lower.includes("is not a valid pokemon name") || lower.includes("you are already collecting this pokemon")) {
        
        if (state) channelStates.delete(message.channel.id);
        return;
      }

      
      // --- CAMBIO AQUÍ: PASAR EL ID DEL AUTOR ---
      const extracted = extractPokemonName(rawContent, message.author.id);
      
      // [LOG-NB] 3: Nombre extraído
      console.log(`[LOG-NB] Nombre extraído (extractPokemonName): ${extracted}`);
      
      if (!extracted) {
        if (state) channelStates.delete(message.channel.id);
        return;
      }

     
      const normalizedExtracted = normalizeForComparison(extracted);
      
      // [LOG-NB] 4: Nombre normalizado
      console.log(`[LOG-NB] Nombre normalizado para comparación: ${normalizedExtracted}`);

      // =========================================================================
      // === FIX CRÍTICO: Carga el estado de bloqueo más reciente desde el disco ===
      const currentLockStatus = getLocksFromDisk();
      // =========================================================================

      let matched = null;
      // Itera sobre el estado recién cargado
      for (const key of Object.keys(currentLockStatus || {})) {
        // La clave de bloqueo también pasa por normalizeForComparison, eliminando el selector \uFE0F
        if (normalizeForComparison(key) === normalizedExtracted) {
          matched = [key, currentLockStatus[key]]; // Usa el estado recién cargado
          // [LOG-NB] 5: Coincidencia encontrada
          console.log(`[LOG-NB] ✅ Coincidencia EXCACTA encontrada con clave de bloqueo: ${key}`);
          break;
        }
      }

      
      if (!matched) {
        
        // [LOG-NB] 6: No se encontró coincidencia
        console.log(`[LOG-NB] ❌ No se encontró coincidencia en lockStatusData para: ${normalizedExtracted}`);
        
        if (state) channelStates.delete(message.channel.id);
        return;
      }

      
      const [pokemonKey, status] = matched;
      if (!status || !status.is_locked) {
        // [LOG-NB] Bloqueo no activo
        console.log(`[LOG-NB] ⚠️ Coincidencia encontrada (${pokemonKey}) pero is_locked es false en lock_status.json.`);
        if (state) channelStates.delete(message.channel.id);
        return;
      }

      // [LOG-NB] Bloqueo inminente
      console.log(`[LOG-NB] ✅ Bloqueo activo. Preparando bloqueo para ${pokemonKey} (${status.lock_type}) en #${message.channel.name}`);
      
      
      const cooldownTime = 30000;
      const cooldownKey = `lock_${message.channel.id}`;
      if (cooldowns.has(cooldownKey)) {
        const expirationTime = cooldowns.get(cooldownKey) + cooldownTime;
        if (now < expirationTime) {
          console.log(`[LOG-NB] ⏳ Bloqueo omitido: En enfriamiento (cooldown) para el canal. (Vence en ${Math.round((expirationTime - now) / 1000)}s)`);
          if (state) channelStates.delete(message.channel.id);
          return;
        }
      } else {
        console.log(`[LOG-NB] ✅ Cooldown listo. Procediendo con el bloqueo.`);
      }

      try {
        
        const existingMessages = await message.channel.messages.fetch({ limit: 5 });
        const hasWarning = existingMessages.some(m =>
          m.author.id === client.user.id && m.components && m.components.length > 0
        );
        
        console.log(`[LOG-NB] Estado de advertencia (hasWarning): ${hasWarning}`);


        if (!hasWarning) {
          cooldowns.set(cooldownKey, now);
          setTimeout(() => cooldowns.delete(cooldownKey), cooldownTime);

          const isPrivate = status.lock_type === 'private';
          console.log(`[LOG-NB] Iniciando lockChannel(hideChannel: ${isPrivate})...`);
          await lockChannel(message.channel, isPrivate);
          lockedChannels.set(message.channel.id, { type: status.lock_type, pokemon: pokemonKey });
          saveLockedChannels(lockedChannels);

          
          if (isPrivate) {
            const spawnRole = message.guild.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);
            if (spawnRole) {
              await message.channel.permissionOverwrites.edit(spawnRole.id, {
                ViewChannel: false
              });
            }
          }

          const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`unlock_${message.channel.id}`)
              .setLabel('🔒 BLOQUEADO')
              .setStyle(ButtonStyle.Danger)
          );

          const mentionRoleId = config.mentionRoles[message.guild.id];
          const mention = mentionRoleId ? ` <@&${mentionRoleId}>` : '';
          const messageContent = isPrivate
            ? `🧭 **${pokemonKey}** **𝘿𝙚𝙩𝙚𝙘𝙩𝙖𝙙𝙤!**${mention}`
            : `${pokemonKey} detectado${mention}`;

          const lockMessage = await message.channel.send({
            content: messageContent,
            components: [button]
          });

          lockMessages.set(message.channel.id, {
            messageId: lockMessage.id,
            channelId: message.channel.id,
            timestamp: Date.now()
          });
          
          // [LOG-NB] Bloqueo exitoso
          console.log(`[LOG-NB] ✅ Bloqueo de canal exitoso para ${pokemonKey}`);


          if (config.logChannel) {
            const logChannel = client.channels.cache.get(config.logChannel);
            if (logChannel) {
              logChannel.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(status.lock_type === 'private' ? 0xFF0000 : 0xFFA500)
                    .setTitle(`🔒 Bloqueo ${status.lock_type === 'private' ? 'Privado' : 'Público'}`)
                    .setDescription(`**Canal:** ${message.channel.name}\n**Pokémon:** ${pokemonKey}`)
                    .setTimestamp()
                ]
              }).catch(console.error);
            }
          }
        } else {
          console.log('[LOG-NB] 🚫 Bloqueo omitido: Ya existe un mensaje de advertencia (botón) en los últimos 5 mensajes.');
        }
      } catch (error) {
        console.error(`❌ Error CRÍTICO en el proceso de bloqueo para ${pokemonKey}:`, error);
      } finally {
        
        if (state) channelStates.delete(message.channel.id);
      }
      return;
    }

    
  } catch (err) {
    console.error('❌ Error en messageCreate handler:', err);
  }
});

// ========== INTERACCIONES (corregido aquí) ==========
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // === BOTONES DE DESBLOQUEO ===
  if (interaction.customId.startsWith('unlock_')) {
    try {
      const channelId = interaction.customId.split('_')[1];
      const channel = await client.channels.fetch(channelId);
      const lockInfo = lockedChannels.get(channelId);

      const member = await interaction.guild.members.fetch(interaction.user.id);
      const spawnRole = member.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);

      if (lockInfo?.type === 'private' && !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({
          content: '❌ Solo staff puede desbloquear canales privados',
          ephemeral: true
        });
      }

      if (!spawnRole && !member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.reply({
          content: `❌ Necesitas el rol "${SPAWN_ROLE_NAME}" o permisos de staff`,
          ephemeral: true
        });
      }
      
      await interaction.deferUpdate();

      
      try {
        await interaction.message.delete();
        lockMessages.delete(channelId); 
      } catch (error) {
        console.error('❌ Error al borrar mensaje de bloqueo/interacción:', error);
      }

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
    return;
  }

  // === BOTONES DE LB (lb command interactions) ===
  else if (interaction.customId.startsWith('bl_')) {
    const command = commands.prefixCommands['lb']; 
    if (command && command.handleInteraction) {
      await command.handleInteraction(interaction, { 
        client,
        paginationStates: client._paginationStates || new Collection(),
        lockedChannels
      });
    }
    return;
  }

  // === BOTONES DE PAGINACIÓN (OTROS COMANDOS: locklist) ===
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

    
    const commandName = state.commandName;
    const command = commands.prefixCommands[commandName];

    if (command && command.handlePagination) {
      // 🔑 CORRECCIÓN CRÍTICA: Se pasa paginationStates y generatePaginationButtons dentro de un objeto de dependencias
      // Esto resuelve el error "paginationStates is undefined" dentro de locklist.js
      await command.handlePagination(interaction, state, {
        paginationStates: paginationStates, // Usamos la variable global/local Collection
        generatePaginationButtons: generatePaginationButtons // Usamos la función global
      });
    }
    return;
  }
});

// ========== MANEJO DE ERRORES (sin cambios) ==========
process.on('unhandledRejection', error => {
  console.error('❌ Rechazo no controlado:', error);
});

process.on('uncaughtException', error => {
  console.error('❌ Excepción no detectada:', error);
  process.exit(1);
});

// ========== INICIAR BOT (sin cambios) ==========
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('❌ Error al iniciar sesión:', error);
  process.exit(1);
});
