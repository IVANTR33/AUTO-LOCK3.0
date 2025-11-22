const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'log',
    description: 'Establece el canal para logs.',
    async execute(client, message, args, { config, saveConfig }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Se requieren permisos de administrador.');
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('❌ Menciona un canal válido.');
        }

        config.logChannel = channel.id;
        saveConfig();
        
        return message.reply(`✅ Canal de logs establecido a ${channel.name}`);
    },
};