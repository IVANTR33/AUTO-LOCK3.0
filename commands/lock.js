const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'lock',
    description: 'Bloquea manualmente un canal de spawn y asigna un nombre al bloqueo.',
    async execute(client, message, args, { lockChannel, lockedChannels, saveLockedChannels, config, lockMessages }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
            return message.reply('❌ Se requieren permisos para gestionar canales.');
        }

        let channel, name;
        const channelMention = message.mentions.channels.first();
        
        if (channelMention) {
            channel = channelMention;
            name = args.slice(1).join(' ').trim();
        } else {
            channel = message.channel;
            name = args.join(' ').trim();
        }
        
        const lockName = name || 'Manual';

        if (!/^\d{1,3}$/.test(channel.name) || parseInt(channel.name) > 450) {
            return message.reply('❌ Este comando solo funciona en canales de spawn (1-450).');
        }

        try {
            const success = await lockChannel(channel, false);
            if (!success) {
                return message.reply('❌ No se pudo bloquear el canal. Verifica los permisos del bot.');
            }

            lockedChannels.set(channel.id, { type: 'public', pokemon: lockName });
            saveLockedChannels(lockedChannels);

            const button = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`unlock_${channel.id}`)
                    .setLabel('🔒 BLOQUEADO')
                    .setStyle(ButtonStyle.Danger)
            );

            const lockMessage = await channel.send({
                content: `✅ Canal ${channel.name} bloqueado manualmente por **${lockName}**.`,
                components: [button]
            });

            lockMessages.set(channel.id, {
                messageId: lockMessage.id,
                channelId: channel.id,
                timestamp: Date.now()
            });

            // --- Lógica de confirmación de bloqueo remoto ---
            if (message.channel.id !== channel.id) {
                message.reply(`✅ Canal ${channel.name} bloqueado con éxito.`);
            }
            // --- Fin de la lógica de confirmación ---

            if (config.logChannel) {
                const logChannel = client.channels.cache.get(config.logChannel);
                if (logChannel) {
                    logChannel.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xFFA500)
                                .setTitle('🔒 Bloqueo Manual')
                                .setDescription(`**Canal:** ${channel.name}\n**Por:** ${message.author.tag}\n**Nombre:** ${lockName}`)
                                .setTimestamp()
                        ]
                    }).catch(console.error);
                }
            }
        } catch (error) {
            console.error('❌ Error en comando lock:', error);
            message.reply('❌ Error al bloquear el canal. Verifica la consola.');
        }
    },
};