// help.js — versión interactiva con botones para comandos
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

// ---------- CONSTANTES CLAVE ----------
// 5 minutos = 300,000 ms
const TIMEOUT_DURATION_MS = 5 * 60 * 1000;
// Límite de botones por fila para el MENÚ PRINCIPAL
const MENU_BUTTONS_PER_ROW = 3;
// --------------------------------------

// Información de comandos (ACTUALIZADA)
const COMMANDS_INFO = {
  help: {
    description: "Muestra esta lista de comandos",
    usage: "!help [comando]",
    examples: ["!help", "!help lb"],
  },
  lb: {
    description: "Menú interactivo para  marcar nombres para bloquear los spawns Pokémon",
    usage: "!lb [nombre_pokemon]",
    examples: ["!lb", "!lb rayquaza"],
  },
  locklist: {
    description: "Muestra los canales bloqueados (GLOBAL)",
    usage: "!locklist",
    examples: ["!locklist"],
  },
  locks: {
    description: "Muestra los canales bloqueados SOLO en este servidor",
    usage: "!locks",
    examples: ["!locks"],
  },
  role: {
    description: "Establece el rol a mencionar en bloqueos",
    usage: "!role @rol",
    examples: ["!role @Staff"],
  },
  log: {
    description: "Establece el canal para logs",
    usage: "!log #canal",
    examples: ["!log #logs"],
  },
  lock: {
    description: "Bloquea manualmente un canal de spawn y le asigna un nombre",
    usage: "!lock [#canal] <nombre>",
    examples: ["!lock", "!lock #canal2 Zygarde", "!lock Jirachi"],
  },
  unlock: {
    description: "Desbloquea manualmente un canal de spawn",
    usage: "!unlock [#canal]",
    examples: ["!unlock", "!unlock #canal2"],
  },
  ls: {
    description:
      "Busca canales bloqueados por un Pokémon específico en este servidor",
    usage: "!ls <nombre>",
    examples: ["!ls zygarde", "!ls pikachu"],
  },
  ts: {
    description: "Muestra el ranking de todos los Pokémon con canales bloqueados",
    usage: "!ts",
    examples: ["!ts"],
  },
  spawn: {
    description:
      "Busca un Pokémon en los últimos spawns del servidor actual",
    usage: "!spawn <nombre>",
    examples: ["!spawn rayquaza", "!spawn jirachi"],
  },
  stats: {
    description:
      "Muestra estadísticas avanzadas del bot (servidores, usuarios, canales bloqueados)",
    usage: "!stats",
    examples: ["!stats"],
  },
};

const COMMANDS_KEYS = Object.keys(COMMANDS_INFO);

// ---------- Helper: Temporizador de Inactividad ----------
function setActivityTimeout(message, state, paginationStates) {
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
  }

  const timeoutId = setTimeout(async () => {
    const latestState = paginationStates.get(message.id);
    if (!latestState) return;

    latestState.timeoutId = null;
    paginationStates.set(message.id, latestState);

    try {
      // Helper para deshabilitar componentes (similar al de lb.js)
      const disableComponents = (rows) => {
        return rows.map((row) => {
          if (row.components && Array.isArray(row.components)) {
            const newRow = new ActionRowBuilder();
            row.components.forEach((comp) => {
              if (comp && comp.data && comp.data.type === 2) {
                const disabledButton = ButtonBuilder.from(comp.data).setDisabled(true);
                newRow.addComponents(disabledButton);
              } else if (comp) {
                newRow.addComponents(comp);
              }
            });
            return newRow;
          }
          return row;
        }).filter(r => r.components && r.components.length > 0);
      };

      const messageComponents = message.components.map(row => ActionRowBuilder.from(row.toJSON()));
      const disabledComponents = disableComponents(messageComponents);

      if (message.editable) {
        await message.edit({
          content: "⏳ Sesión de ayuda expirada por inactividad. Vuelve a ejecutar el comando.",
          components: disabledComponents,
          embeds: message.embeds,
        });
      }
      paginationStates.delete(message.id);
    } catch (e) {
      console.error(`Error deshabilitando botones para el mensaje ${message.id}:`, e);
      paginationStates.delete(message.id);
    }
  }, TIMEOUT_DURATION_MS);

  state.timeoutId = timeoutId;
  state.lastActivity = Date.now();
  paginationStates.set(message.id, state);
}


// ---------- Helper: Generador de Embed de Comandos ----------

function generateCommandEmbed(commandKey) {
  const cmd = COMMANDS_INFO[commandKey];
  if (!cmd) return null;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Ayuda para: !${commandKey}`)
    .addFields(
      { name: "Descripción", value: cmd.description },
      { name: "Uso", value: `\`${cmd.usage}\`` },
      { name: "Ejemplos", value: cmd.examples.map((e) => `\`${e}\``).join("\n") }
    );

  if (cmd.aliases && cmd.aliases.length > 0) {
    embed.addFields({ name: "Alias", value: cmd.aliases.join(", ") });
  }

  return embed;
}

function generateMenuEmbed() {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("📝 Lista de Comandos Interactiva")
    .setDescription("Haz clic en un botón para ver los detalles del comando.");
}


// ---------- Helper: Generador de Botones del Menú Principal ----------

function generateMenuButtons(state) {
  const buttons = COMMANDS_KEYS.map((key) =>
    new ButtonBuilder()
      .setCustomId(`help_cmd_${key}`)
      .setLabel(`!${key}`)
      .setStyle(ButtonStyle.Primary)
  );

  const rows = [];
  let currentRow = new ActionRowBuilder();
  let rowCount = 0;

  for (const button of buttons) {
    if (currentRow.components.length >= MENU_BUTTONS_PER_ROW) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      rowCount++;
    }
    currentRow.addComponents(button);
  }
  if (currentRow.components.length > 0) {
    rows.push(currentRow);
  }

  // Fila final con el botón de cerrar
  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("help_close")
      .setLabel("❌ Cerrar Menú")
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(closeRow);

  return rows;
}

// ---------- Helper: Generador de Botones del Detalle de Comando ----------

function generateDetailButtons(commandKey) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("help_back")
      .setLabel("🔙 Volver a la Lista")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("help_close")
      .setLabel("❌ Cerrar")
      .setStyle(ButtonStyle.Danger)
  );
  return [row];
}


// ---------- EXPORT DEL COMANDO ----------

module.exports = {
  name: "help",
  description: "Muestra la lista de comandos (versión interactiva).",
  aliases: ["ayuda"],

  async execute(client, message, args, options = {}) {
    const paginationStates = options.paginationStates || (client._paginationStates = client._paginationStates || new Map());

    try {
      // Búsqueda directa (no interactiva) si se proporciona un argumento
      if (args && args.length > 0) {
        const query = args[0].toLowerCase();
        const commandKey = COMMANDS_KEYS.find(
          (key) =>
            key === query ||
            (COMMANDS_INFO[key].aliases &&
              COMMANDS_INFO[key].aliases.includes(query))
        );

        if (!commandKey) {
          return message.reply(`❌ No se encontró información para el comando "${args[0]}"`);
        }
        
        const embed = generateCommandEmbed(commandKey);
        return message.reply({ embeds: [embed] });
      }


      // Menú interactivo principal
      const initialState = {
        mode: "menu", // 'menu' o 'detail'
        user: message.author.id,
        // =========================================================================
        // 🔑 CORRECCIÓN CRÍTICA: Añadir messageAuthorId para que index.js pueda verificar el autor
        // =========================================================================
        messageAuthorId: message.author.id, 
        timeoutId: null,
      };

      const embed = generateMenuEmbed();
      const comps = generateMenuButtons(initialState);
      
      const sent = await message.reply({ embeds: [embed], components: comps });

      paginationStates.set(sent.id, initialState);
      setActivityTimeout(sent, initialState, paginationStates);
    } catch (err) {
      console.error("Error execute help:", err);
      try {
        message.reply("❌ Error al abrir el menú de ayuda.");
      } catch (e) {}
    }
  },

  async handleInteraction(interaction, options = {}) {
    try {
      if (!interaction.isButton()) return;
      const paginationStates = options.paginationStates || (interaction.client._paginationStates = interaction.client._paginationStates || new Map());
      await interaction.deferUpdate().catch(() => {});

      const state = paginationStates.get(interaction.message.id);
      if (!state) {
        
        return interaction.followUp({ content: "❌ Sesión expirada.", flags: 64 }).catch(() => {});
      }

      if (String(interaction.user.id) !== String(state.user)) {
        
        return interaction.followUp({ content: "❌ Solo el autor puede usar este menú.", flags: 64 }).catch(() => {});
      }
      
      setActivityTimeout(interaction.message, state, paginationStates);

      // Cierre
      if (interaction.customId === "help_close") {
        if (state.timeoutId) clearTimeout(state.timeoutId);
        paginationStates.delete(interaction.message.id);
        return interaction.message.delete().catch(() => {});
      }
      
      // Volver al Menú Principal
      if (interaction.customId === "help_back") {
          state.mode = 'menu';
          paginationStates.set(interaction.message.id, state);
          
          const embed = generateMenuEmbed();
          const comps = generateMenuButtons(state);
          return interaction.message.edit({ embeds: [embed], components: comps }).catch(() => {});
      }

      // Mostrar detalle del comando
      if (interaction.customId.startsWith("help_cmd_")) {
          const commandKey = interaction.customId.replace("help_cmd_", "");
          const embed = generateCommandEmbed(commandKey);
          
          if (!embed) {
              
              return interaction.followUp({ content: "❌ Comando no encontrado.", flags: 64 }).catch(() => {});
          }
          
          state.mode = 'detail';
          state.currentCommand = commandKey;
          paginationStates.set(interaction.message.id, state);
          
          const comps = generateDetailButtons(commandKey);
          return interaction.message.edit({ embeds: [embed], components: comps }).catch(() => {});
      }


    } catch (err) {
      console.error("Error en handleInteraction help:", err);
      try {
        if (!interaction.replied) interaction.followUp({ content: "❌ Error procesando interacción.", flags: 64 }).catch(() => {});
      } catch (e) {}
    }
  },
};
