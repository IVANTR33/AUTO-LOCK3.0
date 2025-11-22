const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'role',
    description: 'Establece el rol a mencionar en bloqueos.',
    async execute(client, message, args, { config, saveConfig }) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Se requieren permisos de administrador.');
        }

        const role = message.mentions.roles.first();
        if (!role) {
            return message.reply('❌ Menciona un rol válido.');
        }

        config.mentionRoles[message.guild.id] = role.id;
        saveConfig();
        
        return message.reply(`✅ Rol de mención establecido a ${role.name} para este servidor.`);
    },
};