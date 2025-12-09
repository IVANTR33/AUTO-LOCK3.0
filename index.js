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

const SPAWN_ROLE_NAME = "Acceso Spawns";
const PREFIX = '!';
const requiredEnvVars = ['DISCORD_TOKEN', 'POKE_NAME_ID', 'POKETWO_ID'];

// -------------------------------------------------------------------
// ✅ CORRECCIÓN DE LECTURA DE ENV: Se usa process.env[env] en lugar de process.env.env
const missingVars = requiredEnvVars.filter(env => !process.env[env]);
// -------------------------------------------------------------------

if (missingVars.length > 0) {
    console.error(`❌ Faltan variables de entorno: ${missingVars.join(', ')}`);
    process.exit(1);
}

const ADDITIONAL_NAME_IDS = [
    process.env.POKE_NAME_ID_2,
    process.env.POKE_NAME_ID_3,
    process.env.POKE_NAME_ID_4,
    process.env.POKE_NAME_ID_5
];

const NAME_BOT_IDS = Array.from(new Set([
    process.env.POKE_NAME_ID,
    ...ADDITIONAL_NAME_IDS
].filter(Boolean)));

const configPath = path.join(__dirname, 'config.json');
let config = {
    mentionRoles: {},
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

const lockStatusPath = path.join(__dirname, 'lock_status.json');
let lockStatusData = {};

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

function getLocksFromDisk() {
    try {
        if (!fs.existsSync(lockStatusPath)) return {};
        return JSON.parse(fs.readFileSync(lockStatusPath, 'utf-8'));
    } catch (error) {
        console.error("❌ Error al obtener estado de bloqueo del disco:", error);
        return {};
    }
}

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

function extractPokemonName(raw, authorId) {
    if (!raw) return null;
    
    let line = String(raw).split('\n')[0].trim();
    
    const SPECIAL_BOT_ID = '854233015475109888';
    const NIDORAN_SPECIAL_ID = '874910942490677270';
    
    const FEMALE_SYM = '\u2640';
    const MALE_SYM = '\u2642';
    const VARIATION_SELECTOR = '\uFE0F';

    line = line.replace(new RegExp(`nidoran\\s*${MALE_SYM}${VARIATION_SELECTOR}?`, 'gi'), 'NIDORAN_MALE_PLACEHOLDER');
    line = line.replace(new RegExp(`nidoran\\s*${FEMALE_SYM}${VARIATION_SELECTOR}?`, 'gi'), 'NIDORAN_FEMALE_PLACEHOLDER');

    if (line.startsWith('##')) {
        line = line.substring(2).trim();
    }

    if (String(authorId) === SPECIAL_BOT_ID) {
        if (line.toLowerCase().startsWith('type: null:')) {
            const firstColonIndex = line.indexOf(':');
            const secondColonIndex = line.indexOf(':', firstColonIndex + 1);
            if (secondColonIndex !== -1) {
                line = line.substring(0, secondColonIndex);
            }
        } else if (line.includes(':')) {
            line = line.split(':')[0];
        }
    }

    if (line.indexOf('—') !== -1) {
        line = line.split('—')[0].trim();
    }
    
    if (String(authorId) === NIDORAN_SPECIAL_ID) {
        line = line.replace(/\s*\([Ff]\)/g, ' NIDORAN_FEMALE_PLACEHOLDER');
        line = line.replace(/\s*\([Mm]\)/g, ' NIDORAN_MALE_PLACEHOLDER');
    }

    line = line.replace(/【.*?】/g, '');
    line = line.replace(/<a?:[^>]+>/g, '');
    line = line.replace(/:flag_[a-z]{2}:/gi, '');
    
    line = line.replace(/[\[\]〈〉❨❩⦗]/g, '');
    line = line.replace(/\([^)]*\)/g, '');
    
    line = line.replace(/\*\*/g, '');
    line = line.replace(/[\u{1F300}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
    
    line = line.replace(/NIDORAN_MALE_PLACEHOLDER/g, `Nidoran${MALE_SYM}`);
    line = line.replace(/NIDORAN_FEMALE_PLACEHOLDER/g, `Nidoran${FEMALE_SYM}`);

    line = line.replace(/\s+/g, ' ').trim();
    line = line.toLowerCase();

    return line || null;
}

function normalizeForComparison(name) {
    if (!name) return '';
    const strippedName = String(name).replace(/\uFE0F/g, '');
    return strippedName.toLowerCase().trim().replace(/\s+/g, ' ');
}

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
        const poketwoMember = await channel.guild.members.fetch(process.env.POKETWO_ID).catch(() => null);
        if (!poketwoMember) {
            console.error(`❌ FALLO CRÍTICO: Pokétwo no está en el servidor (ID: ${process.env.POKETWO_ID})`);
            return false;
        }

        if (channel.permissionOverwrites.cache.has(process.env.POKETWO_ID)) {
            try {
                await channel.permissionOverwrites.edit(process.env.POKETWO_ID, {
                    SendMessages: true
                });
            } catch (error) {
                console.error('❌ Error al editar permisos de Pokétwo:', error);
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error(`❌ FALLO en unlockChannel en ${channel.name}: ${error.message}`);
        return false;
    }
}

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

function generatePaginationButtons(state) {
    const buttons = new ActionRowBuilder();
    const isFirstPage = state.currentPage === 1;
    const isLastPage = state.currentPage === state.totalPages;

    buttons.addComponents(
        new ButtonBuilder()
            .setCustomId(`${state.customIdPrefix}_prev_page`)
            .setLabel('⬅️ Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isFirstPage),
        new ButtonBuilder()
            .setCustomId(`${state.customIdPrefix}_close_list`)
            .setLabel('❌ Cerrar')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`${state.customIdPrefix}_next_page`)
            .setLabel('Siguiente ➡️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isLastPage),
    );
    return buttons;
}

client._paginationStates = client._paginationStates || new Collection();
const paginationStates = client._paginationStates;

client.on('clientReady', async () => {
    if (!client.user) return console.error("❌ Cliente no disponible en el evento ready.");
    
    const totalGuilds = client.guilds.cache.size;
    const numberedChannels = client.guilds.cache.reduce((acc, guild) => {
        return acc + guild.channels.cache.filter(ch =>
            /^\d{1,3}$/.test(ch.name) && parseInt(ch.name) <= 450
        ).size;
    }, 0);
    
    const freeChannels = numberedChannels - lockedChannels.size;

    console.log(`
╔════════════════════════════════════════════╗
║                                            
║    ✅ ${client.user.tag} En Línea 🟢       
║                                            
╠════════════════════════════════════════════╣
║                                            
║    🗄️  Servidores: ${totalGuilds.toString().padEnd(8)} 
║    📊  Canales totales: ${numberedChannels.toString().padEnd(8)} 
║    🟢  Canales libres: ${freeChannels.toString().padEnd(9)} 
║    🚫  Canales bloqueados: ${lockedChannels.size.toString().padEnd(5)} 
║
║                                            
╚════════════════════════════════════════════╝
    `);
});

client.on('messageCreate', async (message) => {
    try {
        
        if (message.content && message.content.startsWith(PREFIX)) {
            const args = message.content.slice(PREFIX.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            try {
                if (commands.prefixCommands[commandName]) {
                    await commands.prefixCommands[commandName].execute(client, message, args, {
                        lockStatusData,
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
            
            
            const shouldTry = (state && state.waiting) || true;

            if (!shouldTry) return;

            
            const rawContent = message.content || '';
            
        

            
            const lower = rawContent.toLowerCase();
            if (lower.includes("is not a valid pokemon name") || lower.includes("you are already collecting this pokemon")) {
                
                if (state) channelStates.delete(message.channel.id);
                return;
            }

            
            const extracted = extractPokemonName(rawContent, message.author.id);
            
        
            
            if (!extracted) {
                if (state) channelStates.delete(message.channel.id);
                return;
            }

            
            const normalizedExtracted = normalizeForComparison(extracted);
            
        
            
            const currentLockStatus = getLocksFromDisk();
            

            let matched = null;
            
            for (const key of Object.keys(currentLockStatus || {})) {
                
                if (normalizeForComparison(key) === normalizedExtracted) {
                    matched = [key, currentLockStatus[key]];
                    
                    break;
                }
            }

            
            if (!matched) {
                
                
                
                if (state) channelStates.delete(message.channel.id);
                return;
            }

            
            const [pokemonKey, status] = matched;
            if (!status || !status.is_locked) {
                
                if (state) channelStates.delete(message.channel.id);
                return;
            }

            
            
            
            const cooldownTime = 30000;
            const cooldownKey = `lock_${message.channel.id}`;
            if (cooldowns.has(cooldownKey)) {
                const expirationTime = cooldowns.get(cooldownKey) + cooldownTime;
                if (now < expirationTime) {
                    
                    if (state) channelStates.delete(message.channel.id);
                    return;
                }
            } else {
            
            }

            try {
                
                const existingMessages = await message.channel.messages.fetch({ limit: 5 });
                const hasWarning = existingMessages.some(m =>
                    m.author.id === client.user.id && m.components && m.components.length > 0
                );
                
            


                if (!hasWarning) {
                    cooldowns.set(cooldownKey, now);
                    setTimeout(() => cooldowns.delete(cooldownKey), cooldownTime);

                    const isPrivate = status.lock_type === 'private';
                    
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

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('unlock_')) {
        try {
            // CORRECCIÓN DE INTERACCIÓN: Deferir inmediatamente para evitar el error 10062
            await interaction.deferUpdate();

            const channelId = interaction.customId.split('_')[1];
            const channel = await client.channels.fetch(channelId);
            const lockInfo = lockedChannels.get(channelId);

            const member = await interaction.guild.members.fetch(interaction.user.id);
            const spawnRole = member.roles.cache.find(r => r.name === SPAWN_ROLE_NAME);

            // Usar followUp después de deferUpdate

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
            // Si el error ocurrió ANTES del deferUpdate, esto fallará. Si ocurrió DESPUÉS, funcionará.
            // Para mayor seguridad, si la interacción no fue respondida/diferida, followUp lanzará InteractionNotReplied, que es capturado por unhandledRejection.
            interaction.followUp({
                content: '❌ Ocurrió un error al desbloquear',
                ephemeral: true
            });
        }
        return;
    }

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
            await command.handlePagination(interaction, state, {
                paginationStates: paginationStates,
                generatePaginationButtons: generatePaginationButtons
            });
        }
        return;
    }
});

process.on('unhandledRejection', error => {
    console.error('❌ Rechazo no controlado:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Excepción no detectada:', error);
    process.exit(1);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Error al iniciar sesión:', error);
    process.exit(1);
});
