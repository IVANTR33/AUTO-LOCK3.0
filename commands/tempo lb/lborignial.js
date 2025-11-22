// lb.js — versión con Submenús y 4 Botones en TODA la navegación
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

// Rutas - ajusta si hace falta
const categoriesDir = path.join(__dirname, "..", "lock_categories");
const lockStatusPath = path.join(__dirname, "..", "lock_status.json");
const eventDataPath = path.join(__dirname, "..", "event_data.json");

// ---------- CONSTANTES CLAVE ----------
// Define cuántos Pokémon caben en las 3 filas disponibles 
const POKEMON_PER_PAGE = 15;
// Tiempo para depuración: 1 minuto (60,000 ms)
const TIMEOUT_DURATION_MS = 1 * 60 * 1000; 
// Límite de botones por fila para el MENÚ PRINCIPAL y SUBMENÚS (NAVEGACIÓN)
const MENU_BUTTONS_PER_ROW = 4;
// Límite de botones por fila para la SELECCIÓN DE POKÉMON (para densidad)
const SELECTION_BUTTONS_PER_ROW = 5;
// --------------------------------------

// ---------- Helpers I/O ----------
function loadJSONSafe(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8") || "{}");
  } catch (e) {
    console.error("loadJSONSafe error", file, e);
    return {};
  }
}
function saveJSONSafe(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj || {}, null, 2), "utf8");
  } catch (e) {
    console.error("saveJSONSafe error", file, e);
  }
}

// ---------- Sanitización / util ----------
function normalizeName(name = "") {
  const s = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") 
    .replace(/[^a-zA-Z0-9-_ ]/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
  return s.slice(0, 40);
}
function generateSafeId(name, index) {
  return `${normalizeName(name)}_${index.toString(36)}`;
}

// filtra filas vacías, elimina botones inválidos y limita a 5 filas
function cleanRows(rows, maxButtonsPerRow = SELECTION_BUTTONS_PER_ROW) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    try {
      if (!r || typeof r !== "object") continue;
      const comps = (r.components || []).filter(
        (c) => c && typeof c === "object" && c.data && c.data.type
      );
      if (comps.length === 0) continue;
      const newRow = new ActionRowBuilder();
      for (const c of comps.slice(0, maxButtonsPerRow)) {
        newRow.addComponents(c);
      }
      if (newRow.components && newRow.components.length > 0) out.push(newRow);
      if (out.length >= 5) break; 
    } catch (e) {
      continue;
    }
  }
  return out;
}

// Helper para deshabilitar componentes
function disableComponents(rows) {
  return rows.map(row => {
    if (row.components && Array.isArray(row.components)) {
      const newRow = new ActionRowBuilder();
      row.components.forEach(comp => {
        // Solo clonamos y deshabilitamos si es un botón (type 2)
        if (comp && comp.data && comp.data.type === 2) { 
            const disabledButton = ButtonBuilder.from(comp.data).setDisabled(true);
            newRow.addComponents(disabledButton);
        } else if (comp) {
            // Incluir otros componentes (select menus, etc.) sin deshabilitar
            newRow.addComponents(comp);
        }
      });
      return newRow;
    }
    return row;
  }).filter(r => r.components && r.components.length > 0); 
}

// Nueva función para gestionar el temporizador de inactividad
function setActivityTimeout(message, state, paginationStates) {
    // Limpiar temporizador existente
    if (state.timeoutId) {
        clearTimeout(state.timeoutId);
    }

    const timeoutId = setTimeout(async () => {
        const latestState = paginationStates.get(message.id);
        if (!latestState) return;

        latestState.timeoutId = null; 
        paginationStates.set(message.id, latestState); 

        try {
            // CORRECCIÓN DE ERROR DE CONSTRUCTOR: Usamos .toJSON()
            const messageComponents = message.components.map(row => ActionRowBuilder.from(row.toJSON()));
            const disabledComponents = disableComponents(messageComponents);
            
            if (message.editable) {
                await message.edit({
                    content: "⏳ Sesión expirada por inactividad. Vuelve a ejecutar el comando.",
                    components: disabledComponents, 
                    embeds: message.embeds 
                });
            }
            paginationStates.delete(message.id);

        } catch (e) {
            console.error(`Error deshabilitando botones para el mensaje ${message.id}:`, e);
            paginationStates.delete(message.id);
        }
    }, TIMEOUT_DURATION_MS);

    // Guardar el nuevo ID del temporizador y la marca de tiempo
    state.timeoutId = timeoutId;
    state.lastActivity = Date.now();
    paginationStates.set(message.id, state); 
}

// Helper para guardar el estado de bloqueo de un Pokémon individual en el .json
function savePokemonLockStatus(pokemon, locks) {
    // FIX: Estandarizar la clave a minúsculas al GUARDAR en lock_status.json
    locks[pokemon.name.toLowerCase()] = { 
        is_locked: !!pokemon.locked, 
        lock_type: pokemon.type || "public" 
    };
}

// Helper para guardar todo el estado de bloqueo de la lista actual en el .json
function saveListLockStatus(pokemonList, locks) {
    (pokemonList || []).forEach((p) => {
        savePokemonLockStatus(p, locks);
    });
}


// ---------- Eventos / status (no modificados) ----------
function loadEventData() {
  // ... (función no modificada)
  const raw = loadJSONSafe(eventDataPath) || {};
  const now = Date.now();
  let changed = false;
  const out = {};
  for (const k in raw) {
    const ev = raw[k];
    if (ev && ev.expires) {
      const ex = new Date(ev.expires).getTime();
      if (isNaN(ex) || ex > now) out[k] = ev;
      else changed = true;
    } else if (ev) out[k] = ev;
  }
  if (changed) saveJSONSafe(eventDataPath, out);
  return out;
}
function loadLockStatus() {
  return loadJSONSafe(lockStatusPath) || {};
}
function saveLockStatusSafe(status) {
  saveJSONSafe(lockStatusPath, status || {});
}

// ---------- UI helpers (no modificados) ----------
function getBtnStyle(isLocked, type) {
  if (!isLocked) return ButtonStyle.Secondary; 
  if (type === "private") return ButtonStyle.Danger; 
  return ButtonStyle.Success; 
}

function getLockDisplay(isLocked, type) {
  if (!isLocked) return { lock: "⚪", kind: "" }; 
  if (type === "private") return { lock: "🔴", kind: "[PRIV]" }; 
  return { lock: "🟢", kind: "[PUB]" }; 
}

function getGlobalLockState(pokemonList) {
    if (!Array.isArray(pokemonList) || pokemonList.length === 0) {
        return { locked: false, type: 'public', style: ButtonStyle.Secondary, label: "MARCAR TODOS: ⚪ OFF" };
    }
    
    const allLocked = pokemonList.every(p => p.locked);
    const allPublic = allLocked && pokemonList.every(p => p.type === 'public');
    const allPrivate = allLocked && pokemonList.every(p => p.type === 'private');

    if (allPrivate) {
        return { locked: true, type: 'private', style: ButtonStyle.Danger, label: "MARCAR TODOS: 🔴 PRIV" };
    } else if (allPublic) {
        return { locked: true, type: 'public', style: ButtonStyle.Success, label: "MARCAR TODOS: 🟢 PUB" };
    } else {
        return { locked: false, type: 'public', style: ButtonStyle.Secondary, label: "MARCAR TODOS: ⚪ OFF" };
    }
}


// ---------- Generadores Embeds / Buttons ----------

function generateSelectionEmbed(state) {
  const ITEMS = POKEMON_PER_PAGE;
  const totalPages = Math.max(1, Math.ceil((state.pokemon || []).length / ITEMS));
  const page = state.page || 0;
  const start = page * ITEMS;
  const current = (state.pokemon || []).slice(start, start + ITEMS);

  const lines = current.map((p) => {
    const { lock, kind } = getLockDisplay(p.locked, p.type);
    const nice = String(p.name || "").charAt(0).toUpperCase() + String(p.name || "").slice(1);
    
    return `${lock}${kind ? ` ${kind}` : ''} **${nice}**`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x00aaff)
    .setTitle("🔧 " + (state.title || "Categoría"))
    .setDescription((state.description || "").substring(0, 2048) || "*Sin descripción*")
    .addFields([
      {
        name: `Pokémon (${(state.pokemon || []).length}) — Página ${page + 1}/${totalPages}`,
        value: lines.join("\n") || "*No hay Pokémon en esta categoría*",
      },
      {
        name: "🔔 Guardado Automático",
        value: "Todos los cambios se guardan al instante.",
      }
    ]);
  return embed;
}

function generateSelectionButtons(state) {
  const ITEMS = POKEMON_PER_PAGE; 
  const page = state.page || 0;
  const start = page * ITEMS;
  const pageItems = (state.pokemon || []).slice(start, start + ITEMS);

  const rows = [];
  
  const globalState = getGlobalLockState(state.pokemon);

  // Fila 1: Global actions
  const globalRow = new ActionRowBuilder().addComponents(
    // 1. Botón de ciclo de estado global
    new ButtonBuilder()
      .setCustomId("bl_cycle_all")
      .setLabel(globalState.label)
      .setStyle(globalState.style),
      
    // 2. Botón UNMARK ALL
    new ButtonBuilder().setCustomId("bl_unlock_all").setLabel("UNMARK ALL").setStyle(ButtonStyle.Secondary)
  );
  if (globalRow.components.length > 0) {
      rows.push(globalRow);
  }


  // Filas 2, 3, 4: Pokémon buttons (5 botones por fila)
  let currentRow = new ActionRowBuilder();
  let pokemonRowsCount = 0;
  for (let i = 0; i < pageItems.length; i++) {
    const p = pageItems[i];
    const safeId = p.id || generateSafeId(p.name || "p", i);

    if (currentRow.components.length >= SELECTION_BUTTONS_PER_ROW) {
      if (pokemonRowsCount < 3) { 
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
          pokemonRowsCount++;
      } else {
          break; 
      }
    }
    
    if (pokemonRowsCount >= 3 && currentRow.components.length >= SELECTION_BUTTONS_PER_ROW) break;

    let emoji = '⚪';
    if (p.locked) {
      emoji = p.type === 'private' ? '🔴' : '🟢';
    }

    const label = String(p.name || "").slice(0, 80) || safeId;
    
    const btnToggle = new ButtonBuilder()
      .setCustomId(`bl_toggle_cycle_${safeId}`) 
      .setLabel(label)
      .setStyle(getBtnStyle(p.locked, p.type))
      .setEmoji(emoji);
      
    currentRow.addComponents(btnToggle);
  }
  
  if (currentRow.components.length > 0) {
      if (pokemonRowsCount < 3) {
          rows.push(currentRow);
      }
  }

  // Fila 5: Navegación
  const totalPages = Math.max(1, Math.ceil((state.pokemon || []).length / ITEMS));
  
  const backButton = state.parentMenuId 
    ? new ButtonBuilder().setCustomId(`bl_submenu_back_${state.parentMenuId}`).setLabel("🔙 Volver").setStyle(ButtonStyle.Primary)
    : new ButtonBuilder().setCustomId("bl_menu").setLabel("🔙 Menú").setStyle(ButtonStyle.Primary);
    
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("bl_prev").setLabel("◀").setStyle(ButtonStyle.Secondary).setDisabled((state.page || 0) <= 0),
    new ButtonBuilder()
      .setCustomId("bl_page")
      .setLabel(`Pág ${(state.page || 0) + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder().setCustomId("bl_next").setLabel("▶").setStyle(ButtonStyle.Secondary).setDisabled((state.page || 0) >= totalPages - 1),
    backButton,
    new ButtonBuilder().setCustomId("bl_close").setLabel("❌ Cerrar").setStyle(ButtonStyle.Danger)
  );
  rows.push(navRow);

  return cleanRows(rows);
}

// Generador de botones para submenús (usado tanto para menú principal como submenú)
function generateMenuPages(categories, isSubmenu = false) {
  const rows = [];
  let row = new ActionRowBuilder();
  
  // FIX: Usamos siempre el límite de 4 botones para la navegación de menús (principal y submenús)
  const maxButtons = MENU_BUTTONS_PER_ROW; 

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    if (row.components.length >= maxButtons) {
      if (row.components.length > 0) rows.push(row);
      row = new ActionRowBuilder();
    }
    // Si es un submenú, el ID es 'bl_cat_', si es un menú superior, el ID puede ser 'bl_sub_'
    const customIdPrefix = c.is_submenu ? "bl_sub_" : "bl_cat_";

    const btn = new ButtonBuilder()
        .setCustomId(`${customIdPrefix}${c.id}`)
        .setLabel(String(c.title || c.id).slice(0, 80))
        .setStyle(ButtonStyle.Primary); 
    
    try {
      if (c.emoji) btn.setEmoji(c.emoji);
    } catch (e) {
    }
    row.addComponents(btn);
  }
  if (row.components.length > 0) rows.push(row);

  const pages = [];
  const BODY_ROWS_PER_PAGE = 4;
  for (let i = 0; i < rows.length; i += BODY_ROWS_PER_PAGE) {
    const chunk = rows.slice(i, i + BODY_ROWS_PER_PAGE);
    
    const backButton = isSubmenu 
        ? new ButtonBuilder().setCustomId("bl_menu_back_main").setLabel("🔙 home").setStyle(ButtonStyle.Primary)
        : null;

    const nav = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bl_menu_prev").setLabel("◀").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("bl_menu_page").setLabel("Página").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId("bl_menu_next").setLabel("▶").setStyle(ButtonStyle.Secondary),
      ...(backButton ? [backButton] : []), // Añadir botón de regreso solo en submenús
      new ButtonBuilder().setCustomId("bl_menu_close").setLabel("❌ Cerrar").setStyle(ButtonStyle.Danger)
    );
    const pageRows = [...chunk, nav];
    // Se usa el límite de la fila de selección ya que es el máximo.
    pages.push(cleanRows(pageRows, SELECTION_BUTTONS_PER_ROW)); 
  }

  if (pages.length === 0) {
    const nav = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("bl_menu_close").setLabel("❌ Cerrar").setStyle(ButtonStyle.Danger));
    pages.push(cleanRows([nav]));
  }

  return pages;
}


// Función unificada de carga de categorías
function loadCategories(dirPath, idPrefix = "") {
    const loadedCategories = [];
    if (!fs.existsSync(dirPath)) return loadedCategories;
    
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    
    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const data = loadJSONSafe(fullPath) || {};
        const idBase = file.replace(/\.json$/i, "");
        const finalId = idPrefix ? `${idPrefix}_${idBase}` : idBase;

        // Si es un Submenú, cargamos la metadata (title, description, etc.)
        if (data.is_submenu && data.source_dir) {
            loadedCategories.push({
                id: idBase,
                title: data.title || idBase,
                description: data.description || "",
                emoji: data.emoji,
                is_submenu: true,
                source_dir: data.source_dir
            });
            continue;
        }

        // Manejar listas (categorías normales o subcategorías)
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                const sub = data[i];
                loadedCategories.push({ 
                    id: `${finalId}_${i}`, 
                    title: sub.title || `${finalId}_${i}`, 
                    description: sub.description || "", 
                    list: sub.pokemon_list || [], 
                    emoji: sub.emoji 
                });
            }
            continue;
        }

        // Categoría de nivel superior o archivo simple
        loadedCategories.push({ 
            id: finalId, 
            title: data.title || finalId, 
            description: data.description || "", 
            list: data.pokemon_list || [], 
            emoji: data.emoji 
        });
    }

    return loadedCategories;
}

// ---------- Export del comando ----------
module.exports = {
  name: "lb",
  aliases: ["bl", "lock", "locks"],
  description: "Menú interactivo para bloquear/desbloquear Pokémon por categoría",

  async execute(client, message, args = [], options = {}) {
    try {
      const paginationStates = options.paginationStates || (client._paginationStates = client._paginationStates || new Map());

      if (!message.member || !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ Necesitas permiso para gestionar canales.");
      }

      const eventData = loadEventData();
      const eventNames = Object.values(eventData).map((e) => e.name);

      const allCategories = loadCategories(categoriesDir);
      
      // Caso especial: rellenar la lista de la categoría 'event'
      const eventCat = allCategories.find(c => c.id === 'event');
      if (eventCat) {
          eventCat.list = eventNames;
      }
      
      const pages = generateMenuPages(allCategories);
      const embed = new EmbedBuilder().setColor(0x33ff66).setTitle("⚙️ Menú de Bloqueo Interactivo").setDescription("Selecciona una categoría.");

      const comps = (pages && pages[0]) || [];
      const safeComps = cleanRows(comps, SELECTION_BUTTONS_PER_ROW);
      const payload = { embeds: [embed] };
      if (safeComps.length > 0) payload.components = safeComps;

      const sent = await message.reply(payload);

      const initialState = { 
        mode: "menu", // 'menu', 'submenu', 'select'
        page: 0, 
        pages, 
        user: message.author.id, 
        categories: allCategories, 
        timeoutId: null 
      };
      paginationStates.set(sent.id, initialState);
      
      setActivityTimeout(sent, initialState, paginationStates);

    } catch (err) {
      console.error("Error execute lb:", err);
      try {
        message.reply("❌ Error al abrir el menú.");
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
        return interaction.followUp({ content: "❌ Sesión expirada.", ephemeral: true }).catch(() => {});
      }

      if (String(interaction.user.id) !== String(state.user)) {
        return interaction.followUp({ content: "❌ Solo el autor puede usar este menú.", ephemeral: true }).catch(() => {});
      }
      
      setActivityTimeout(interaction.message, state, paginationStates);


      // ---------- NAVEGACIÓN GENERAL (Menú Principal / Submenú) ----------
      if (state.mode === "menu" || state.mode === "submenu") {
        
        // Cierre
        if (interaction.customId === "bl_menu_close") {
          if (state.timeoutId) clearTimeout(state.timeoutId);
          paginationStates.delete(interaction.message.id);
          return interaction.message.delete().catch(() => {});
        }
        
        // Paginación
        if (interaction.customId === "bl_menu_prev") {
          state.page = Math.max(0, (state.page || 0) - 1);
          paginationStates.set(interaction.message.id, state);
          const comps = cleanRows(state.pages[state.page] || [], SELECTION_BUTTONS_PER_ROW);
          return interaction.message.edit({ components: comps }).catch(() => {});
        }
        if (interaction.customId === "bl_menu_next") {
          state.page = Math.min((state.pages || []).length - 1, (state.page || 0) + 1);
          paginationStates.set(interaction.message.id, state);
          const comps = cleanRows(state.pages[state.page] || [], SELECTION_BUTTONS_PER_ROW);
          return interaction.message.edit({ components: comps }).catch(() => {});
        }
        
        // Volver al Menú Principal desde Submenú (si aplica)
        if (interaction.customId === "bl_menu_back_main" && state.mode === "submenu") {
            const allCategories = loadCategories(categoriesDir); // Recargar categorías principales
            const menuPages = generateMenuPages(allCategories);
            const menuEmbed = new EmbedBuilder().setColor(0x33ff66).setTitle("⚙️ Menú de Bloqueo Interactivo").setDescription("Selecciona una categoría.");
            
            const newState = {
                mode: "menu",
                page: 0,
                pages: menuPages,
                user: interaction.user.id,
                categories: allCategories,
                timeoutId: state.timeoutId,
            };
            
            const comps = cleanRows(newState.pages[0] || [], SELECTION_BUTTONS_PER_ROW);
            paginationStates.set(interaction.message.id, newState);
            return interaction.message.edit({ embeds: [menuEmbed], components: comps }).catch(() => {});
        }

        // 1. Manejo de Botón de SUBMENÚ (Ej: bl_sub_types)
        if (interaction.customId.startsWith("bl_sub_")) {
            const menuId = interaction.customId.replace("bl_sub_", "");
            const parentCat = (state.categories || []).find((c) => String(c.id) === String(menuId) && c.is_submenu);
            
            if (!parentCat || !parentCat.source_dir) {
                return interaction.followUp({ content: "❌ Submenú no encontrado.", ephemeral: true }).catch(() => {});
            }

            const subDir = path.join(categoriesDir, parentCat.source_dir);
            const subCategories = loadCategories(subDir, menuId);
            const subPages = generateMenuPages(subCategories, true); // True para indicar que es submenú

            const subEmbed = new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle(`🔧 Submenú: ${parentCat.title}`)
                .setDescription(parentCat.description || "Selecciona una subcategoría.");

            const newState = {
                mode: "submenu",
                page: 0,
                pages: subPages,
                user: interaction.user.id,
                categories: subCategories, // Ahora las categorías son los tipos
                parentMenuId: menuId,
                timeoutId: state.timeoutId,
            };

            const comps = cleanRows(newState.pages[0] || [], SELECTION_BUTTONS_PER_ROW);
            paginationStates.set(interaction.message.id, newState);
            return interaction.message.edit({ embeds: [subEmbed], components: comps }).catch(() => {});
        }

        // 2. Manejo de Botón de CATEGORÍA (Ej: bl_cat_legends, bl_cat_types_electric)
        if (interaction.customId.startsWith("bl_cat_")) {
          const catId = interaction.customId.replace("bl_cat_", "");
          const cat = (state.categories || []).find((c) => String(c.id) === String(catId));
          
          if (!cat) return interaction.followUp({ content: "❌ Categoría no encontrada.", ephemeral: true }).catch(() => {});
          
          const locks = loadLockStatus() || {};
          const pokemon = (cat.list || []).map((name, i) => {
            
            // FIX: Estandarizar el nombre a minúsculas al BUSCAR el estado.
            const lowerName = name.toLowerCase(); 
            
            // Usamos lowerName para la búsqueda
            const currentLock = !!(locks[lowerName] && locks[lowerName].is_locked);
            const currentType = (locks[lowerName] && locks[lowerName].lock_type) || "public";

            return {
                name,
                id: generateSafeId(name, i),
                locked: currentLock,
                type: currentType,
            };
          });

          const st = {
            mode: "select",
            user: interaction.user.id,
            title: cat.title || cat.id,
            description: cat.description || "",
            categoryId: catId,
            pokemon,
            page: 0,
            categories: state.categories,
            menuPages: state.pages,
            parentMenuId: state.mode === 'submenu' ? state.parentMenuId : null,
            timeoutId: state.timeoutId,
          };

          const embed = generateSelectionEmbed(st);
          const comps = generateSelectionButtons(st);
          const safeComps = cleanRows(comps, SELECTION_BUTTONS_PER_ROW);

          paginationStates.set(interaction.message.id, st);
          return interaction.message.edit({ embeds: [embed], components: safeComps }).catch(() => {});
        }

        // Si no se hizo nada, redibujar el menú actual
        const comps = cleanRows(state.pages[state.page] || [], SELECTION_BUTTONS_PER_ROW);
        return interaction.message.edit({ components: comps }).catch(() => {});
      }

      // ---------- SELECT MODE (Selección de Pokémon) ----------
      if (state.mode === "select") {
        const ITEMS = POKEMON_PER_PAGE;
        let requiresRedraw = false; 

        // close
        if (interaction.customId === "bl_close") {
          if (state.timeoutId) clearTimeout(state.timeoutId);
          paginationStates.delete(interaction.message.id);
          return interaction.message.delete().catch(() => {});
        }

        // back to menu/submenu
        else if (interaction.customId === "bl_menu" || interaction.customId.startsWith("bl_submenu_back_")) {
          const menuId = interaction.customId.startsWith("bl_submenu_back_") 
            ? interaction.customId.replace("bl_submenu_back_", "") 
            : null;
            
          let newState;
          let menuEmbed;

          if (menuId) {
            // Volver al submenú (Ej: 'types' o 'regiones')
            const allCategories = loadCategories(categoriesDir);
            const parentCat = allCategories.find(c => c.id === menuId && c.is_submenu);
            
            if (!parentCat) { 
                // Fallback si no se encuentra el padre
                return interaction.followUp({ content: "❌ Error de retorno. Volviendo al menú principal.", ephemeral: true });
            }
            
            const subDir = path.join(categoriesDir, parentCat.source_dir);
            const subCategories = loadCategories(subDir, menuId);
            const subPages = generateMenuPages(subCategories, true);
            
            menuEmbed = new EmbedBuilder()
                .setColor(0xffaa00)
                .setTitle(`🔧 Submenú: ${parentCat.title}`)
                .setDescription(parentCat.description || "Selecciona una subcategoría.");
            
            newState = {
                mode: "submenu",
                page: 0,
                pages: subPages,
                user: interaction.user.id,
                categories: subCategories,
                parentMenuId: menuId,
                timeoutId: state.timeoutId,
            };
            
          } else {
            // Volver al menú principal
            const allCategories = loadCategories(categoriesDir);
            const menuPages = generateMenuPages(allCategories);
            menuEmbed = new EmbedBuilder().setColor(0x33ff66).setTitle("⚙️ Menú de Bloqueo Interactivo").setDescription("Selecciona una categoría.");
            
            newState = {
                mode: "menu",
                page: 0,
                user: interaction.user.id,
                categories: allCategories,
                pages: menuPages,
                timeoutId: state.timeoutId,
            };
          }
          
          const comps = cleanRows(newState.pages[0] || [], SELECTION_BUTTONS_PER_ROW);
          paginationStates.set(interaction.message.id, newState);
          return interaction.message.edit({ embeds: [menuEmbed], components: comps }).catch(() => {});
        }


        // pagination
        else if (interaction.customId === "bl_prev") {
          state.page = Math.max(0, (state.page || 0) - 1);
          requiresRedraw = true;
        } else if (interaction.customId === "bl_next") {
          const max = Math.max(0, Math.ceil((state.pokemon || []).length / ITEMS) - 1);
          state.page = Math.min(max, (state.page || 0) + 1);
          requiresRedraw = true;
        }

        // global cycle action (AUTO-SAVE)
        else if (interaction.customId === "bl_cycle_all") {
            const locks = loadLockStatus() || {};
            const globalState = getGlobalLockState(state.pokemon);
            
            let newLocked = false;
            let newType = 'public';

            // Ciclo: 🟢 PUB -> 🔴 PRIV -> ⚪ OFF
            if (globalState.locked && globalState.type === 'private') {
                newLocked = false;
                newType = 'public'; 
            } else if (globalState.locked && globalState.type === 'public') {
                newLocked = true;
                newType = 'private';
            } else {
                newLocked = true;
                newType = 'public';
            }
            
            // Aplicar el nuevo estado
            const anyChange = !state.pokemon.every(p => p.locked === newLocked && p.type === newType);
            if (anyChange) {
                 (state.pokemon || []).forEach((p) => {
                    p.locked = newLocked;
                    p.type = newType;
                });
            }
            
            // GUARDADO INSTANTÁNEO
            saveListLockStatus(state.pokemon, locks);
            saveLockStatusSafe(locks);

            requiresRedraw = true;
            
        } 
        
        // UNMARK ALL action (AUTO-SAVE)
        else if (interaction.customId === "bl_unlock_all") {
            const locks = loadLockStatus() || {};
            const anyWasLocked = state.pokemon.some(p => p.locked === true);
            
            if (anyWasLocked) {
                // Aplicar el nuevo estado (OFF)
                (state.pokemon || []).forEach((p) => {
                    p.locked = false;
                    p.type = "public";
                });
            }
            
            // GUARDADO INSTANTÁNEO
            saveListLockStatus(state.pokemon, locks);
            saveLockStatusSafe(locks);

            requiresRedraw = true;
        }
        
        // per-item actions (AUTO-SAVE)
        else if (interaction.customId.startsWith("bl_toggle_cycle_")) {
          const id = interaction.customId.replace("bl_toggle_cycle_", "");
          const item = (state.pokemon || []).find((x) => String(x.id) === String(id));
          
          if (item) {
             const locks = loadLockStatus() || {};
             
             let newLocked = item.locked;
             let newType = item.type;
             
             // Ciclo: ⚪ OFF -> 🟢 PUB -> 🔴 PRIV -> ⚪ OFF
             if (!item.locked) {
               newLocked = true;
               newType = "public"; 
             } else if (item.type === "public") {
               newType = "private"; 
             } else {
               newLocked = false; 
               newType = "public"; 
             }

             if (item.locked !== newLocked || item.type !== newType) {
                item.locked = newLocked;
                item.type = newType;
                
                // GUARDADO INSTANTÁNEO
                savePokemonLockStatus(item, locks);
                saveLockStatusSafe(locks);
             }
             
             requiresRedraw = true;
          }
        } 

        // Redibujar el mensaje de selección solo si es necesario
        if (requiresRedraw) {
            paginationStates.set(interaction.message.id, state);
            const embed = generateSelectionEmbed(state);
            const comps = generateSelectionButtons(state);
            const safeComps = cleanRows(comps, SELECTION_BUTTONS_PER_ROW);
            return interaction.message.edit({ embeds: [embed], components: safeComps }).catch((e) => {
                console.error("Error editing selection message:", e);
            });
        }
        
        return;
      }
    } catch (err) {
      console.error("Error en handleInteraction lb:", err);
      try {
        if (!interaction.replied) interaction.followUp({ content: "❌ Error procesando interacción.", ephemeral: true }).catch(() => {});
      } catch (e) {}
    }
  },
};