const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'unlock',
    description: 'Desbloquea manualmente un canal de spawn o múltiples canales por Pokémon.',
    async execute(client, message, args, { unlockChannel, lockedChannels, saveLockedChannels, config, lockMessages }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return message.reply('❌ Se requieren permisos para gestionar canales.');
        }

        // Comando para desbloquear todos los canales de un Pokémon específico
        if (args[0]?.toLowerCase() === 'all' && args[1]) {
            return this.handleMassUnlock(client, message, args, { 
                unlockChannel, lockedChannels, saveLockedChannels, config, lockMessages 
            });
        }

        // Comando normal para desbloquear un canal específico
        const channel = message.mentions.channels.first() || message.channel;
        if (!/^\d{1,3}$/.test(channel.name) || parseInt(channel.name) > 450) {
            return message.reply('❌ Este comando solo funciona en canales de spawn (1-450).');
        }

        try {
            const success = await unlockChannel(channel);
            if (!success) {
                return message.reply('❌ No se pudo desbloquear el canal. Verifica que el bot tenga los permisos necesarios.');
            }

            // --- Lógica para borrar el mensaje de bloqueo ---
            const lockMessageData = lockMessages.get(channel.id);
            if (lockMessageData) {
                try {
                    const lockMessageChannel = await client.channels.fetch(lockMessageData.channelId);
                    const lockMessage = await lockMessageChannel.messages.fetch(lockMessageData.messageId);
                    await lockMessage.delete().catch(e => console.error('Error al borrar mensaje de bloqueo:', e));
                    lockMessages.delete(channel.id);
                } catch (error) {
                    console.error('❌ Error al eliminar el mensaje de bloqueo:', error);
                }
            }
            // --- Fin de la lógica de borrado de mensaje ---
            
            lockedChannels.delete(channel.id);
            saveLockedChannels(lockedChannels);

            if (config.logChannel) {
                const logChannel = client.channels.cache.get(config.logChannel);
                if (logChannel) {
                    logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('🔓 Desbloqueo Manual')
                                .setDescription(`**Canal:** ${channel.name}\n**Por:** ${message.author.tag}`)
                                .setTimestamp()
                        ]
                    }).catch(console.error);
                }
            }

            return message.reply(`✅ Canal ${channel.name} desbloqueado manualmente.`);
        } catch (error) {
            console.error('❌ Error en comando unlock:', error);
            return message.reply('❌ Ocurrió un error al desbloquear el canal. Verifica los permisos del bot.');
        }
    },

    // Función para manejar el desbloqueo masivo
    async handleMassUnlock(client, message, args, { unlockChannel, lockedChannels, saveLockedChannels, config, lockMessages }) {
        const pokemonName = args.slice(1).join(' ').toLowerCase();
        const affectedChannels = [];

        // Buscar todos los canales bloqueados por este Pokémon
        for (const [channelId, lockInfo] of lockedChannels) {
            if (lockInfo.pokemon.toLowerCase() === pokemonName) {
                affectedChannels.push(channelId);
            }
        }

        if (affectedChannels.length === 0) {
            return message.reply(`❌ No se encontraron canales bloqueados por ${pokemonName}.`);
        }

        // Limitar el número de canales a desbloquear para evitar rate limits
        const MAX_CHANNELS_PER_BATCH = 5;
        const batches = Math.ceil(affectedChannels.length / MAX_CHANNELS_PER_BATCH);
        
        try {
            const loadingMsg = await message.reply(`🔍 Desbloqueando ${affectedChannels.length} canales de ${pokemonName} (procesando en lotes de ${MAX_CHANNELS_PER_BATCH})...`);

            for (let i = 0; i < batches; i++) {
                const batch = affectedChannels.slice(
                    i * MAX_CHANNELS_PER_BATCH, 
                    (i + 1) * MAX_CHANNELS_PER_BATCH
                );

                // Procesar cada canal en el lote actual
                for (const channelId of batch) {
                    try {
                        const channel = await client.channels.fetch(channelId);
                        const success = await unlockChannel(channel);
                        
                        if (success) {
                            // Eliminar mensaje de bloqueo si existe
                            const lockMessageData = lockMessages.get(channelId);
                            if (lockMessageData) {
                                try {
                                    const lockMessageChannel = await client.channels.fetch(lockMessageData.channelId);
                                    const lockMessage = await lockMessageChannel.messages.fetch(lockMessageData.messageId);
                                    await lockMessage.delete().catch(console.error);
                                    lockMessages.delete(channelId);
                                } catch (error) {
                                    console.error('❌ Error al eliminar mensaje de bloqueo:', error);
                                }
                            }

                            lockedChannels.delete(channelId);
                        } else {
                            console.error(`❌ No se pudo desbloquear el canal ${channelId}`);
                        }
                    } catch (error) {
                        console.error(`❌ Error al procesar el canal ${channelId}:`, error);
                    }
                }

                // Guardar cambios después de cada lote
                saveLockedChannels(lockedChannels);

                // Pequeña pausa entre lotes para evitar rate limits
                if (i < batches - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }

            // Actualizar mensaje de estado
            await loadingMsg.edit(`✅ Se han desbloqueado ${affectedChannels.length} canales de ${pokemonName}.`);

            // Registrar en el canal de logs
            if (config.logChannel) {
                const logChannel = client.channels.cache.get(config.logChannel);
                if (logChannel) {
                    logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0x00FF00)
                                .setTitle('🔓 Desbloqueo Masivo')
                                .setDescription(`**Pokémon:** ${pokemonName}\n**Canales desbloqueados:** ${affectedChannels.length}\n**Por:** ${message.author.tag}`)
                                .setTimestamp()
                        ]
                    }).catch(console.error);
                }
            }

        } catch (error) {
            console.error('❌ Error en desbloqueo masivo:', error);
            return message.reply('❌ Ocurrió un error durante el desbloqueo masivo.');
        }
    }
};