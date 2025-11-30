/**
 * Muestra un modal genérico, apilable, con contenido y botones personalizados.
 * @param {Object} options
 * @param {string|HTMLElement} options.title - Título del modal
 * @param {string|HTMLElement} options.content - Contenido HTML o nodo
 * @param {Array<{id?:string, label:string, className?:string}>} options.buttons - Botones a mostrar (id es recomendable para distinguir acciones)
 * @param {Function} [options.onAction] - Callback único para cualquier acción (botón, escape, backdrop). Recibe (id, event). Si retorna false, el modal NO se cierra. Por defecto se cierra.
 * @param {boolean} [options.closeOnEscape] - Permite cerrar con Escape (por defecto: false)
 * @param {boolean} [options.closeOnBackdrop] - Permite cerrar al pulsar fuera (por defecto: false)
 * @returns {Function} closeModal - Permite cerrar el modal programáticamente
 */
export function showModal({ title, content, buttons = [], onAction, closeOnEscape = false, closeOnBackdrop = false, buttonsContainerClass = '' }) {
  if (!window.__modalStack) window.__modalStack = [];
  const stack = window.__modalStack;
  // Crear overlay (backdrop)
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = 10000 + stack.length * 2;

  // Modal principal (estructura igual a index.html)
  const modal = document.createElement('div');
  modal.className = 'modal-content game-panel w-11/12 p-6 text-center';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.style.zIndex = 10001 + stack.length * 2;
  // El ancho y el layout lo controlan solo las clases CSS y Tailwind
  modal.style.maxWidth = '';
  modal.style.width = '';
  modal.style.maxHeight = '';
  modal.style.overflow = '';
  modal.style.display = '';
  modal.style.flexDirection = '';

  // Título
  const titleEl = document.createElement('h2');
  titleEl.className = 'modal-title font-bold text-3xl mb-4';
  if (typeof title === 'string') titleEl.textContent = title;
  else if (title instanceof HTMLElement) titleEl.appendChild(title);
  modal.appendChild(titleEl);

  // Contenido principal
  let contentEl;
  if (typeof content === 'string') {
    contentEl = document.createElement('p');
    contentEl.className = 'text-lg mb-6';
    contentEl.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    contentEl = content;
    if (!contentEl.classList.contains('mb-6')) contentEl.classList.add('mb-6');
  }
  // Contenedor scrollable
  const scrollWrap = document.createElement('div');
  scrollWrap.style.flex = '1 1 auto';
  scrollWrap.style.overflowY = 'auto';
  scrollWrap.style.maxHeight = '60vh';
  if (contentEl) scrollWrap.appendChild(contentEl);
  modal.appendChild(scrollWrap);

  // Botones
  if (buttons && buttons.length > 0) {
    const btnsDiv = document.createElement('div');
    // btnsDiv.className = 'modal-buttons flex flex-col sm:flex-row justify-center gap-4';
    btnsDiv.className = 'modal-buttons flex flex-col sm:flex-row justify-center gap-4 w-full px-2';
    if (buttonsContainerClass) {
      btnsDiv.className += ' ' + buttonsContainerClass;
    }
    btnsDiv.style.flex = 'none';
    btnsDiv.style.marginTop = '2em';
    buttons.forEach(({ id, label, className = '' }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      // Si hay exactamente dos botones, agregar w-1/2 para que ocupen el 50%
      let extraClass = '';
      if (buttons.length === 2) extraClass += ' w-1/2';
      btn.className = 'btn ' + className + extraClass;
      btn.onclick = (e) => {
        e.stopPropagation();
        const actionId = id || label;
        let shouldClose = true;
        if (typeof onAction === 'function') {
          const res = onAction(actionId, e);
          if (res === false) shouldClose = false;
        }
        if (shouldClose) closeModal();
      };
      btnsDiv.appendChild(btn);
    });
    modal.appendChild(btnsDiv);
  }

  // Cerrar con Escape (opcional)
  let escListener = null;
  if (closeOnEscape) {
    escListener = function(e) {
      if (e.key === 'Escape' && stack[stack.length - 1] === closeModal) {
        let shouldClose = true;
        if (typeof onAction === 'function') {
          const res = onAction('cancel', e);
          if (res === false) shouldClose = false;
        }
        if (shouldClose) closeModal();
      }
    };
    document.addEventListener('keydown', escListener);
  }

  // Apilar y mostrar
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Hacer visible el modal (como los originales)
  overlay.classList.add('visible');
  stack.push(closeModal);

  // Cerrar modal
  let closed = false;
  function closeModal() {
    if (closed) return;
    closed = true;
    if (escListener) document.removeEventListener('keydown', escListener);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    const idx = stack.indexOf(closeModal);
    if (idx !== -1) stack.splice(idx, 1);
    // onClose eliminado, todo se maneja por onAction
  }
  // Cerrar al pulsar fuera del modal (opcional)
  if (closeOnBackdrop) {
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && stack[stack.length - 1] === closeModal) {
        let shouldClose = true;
        if (typeof onAction === 'function') {
          const res = onAction('cancel', e);
          if (res === false) shouldClose = false;
        }
        if (shouldClose) closeModal();
      }
    });
  }
  return closeModal;
}

// --- Letter Loom: Modal dialogs (refactorized, decoupled) ---

/**
 * Show the player customization modal.
 * @param {Object} options - All dependencies needed by the modal.
 * @param {Object} options.gameController
 * @param {Object} options.TEXTS
 * @param {string} options.currentLanguage
 * @param {Function} options.getDefaultPlayerName
 * @param {Function} options.getDisplayName
 * @param {Function} options.loadNameHistory
 * @param {Function} options.saveNameHistory
 * @param {Array} options.PLAYER_COLORS
 * @param {Function} options.onSave - Callback when user saves (players array)
 * @param {Function} options.onCancel - Callback when user cancels
 */
export function showPlayerCustomizationModal({
  gameController,
  TEXTS,
  currentLanguage,
  getDefaultPlayerName,
  getDisplayName,
  loadNameHistory,
  saveNameHistory,
  PLAYER_COLORS,
  onSave,
  onCancel
}) {
  // --- Estado inicial y helpers ---
  const state = gameController.getState();
  let modalPlayers = state.players.map((p) => ({ ...p }));
  // --- Modal principal ---
  let modalDiv = document.createElement("div");
  modalDiv.style.width = "100%";
  modalDiv.style.maxWidth = "100%";
  modalDiv.innerHTML = `<div id="modal-input-container"></div>`;

  function renderModal() {
    const container = modalDiv.querySelector("#modal-input-container");
    container.innerHTML = "";
    modalPlayers.forEach((player, idx) => {
      const row = document.createElement("div");
      row.className = "mb-2 flex items-center gap-1 justify-center player-row";
      row.dataset.playerIdx = idx;
      row.style.background = "#f8f8f8";
      row.style.borderRadius = "0.7em";
      row.style.boxShadow = "0 1px 2px #0001";
      row.style.transition = "box-shadow 0.2s";
      row.setAttribute("draggable", "true");
      // Drag icon
      const dragIcon = document.createElement("span");
      dragIcon.innerHTML = "&#x2630;";
      dragIcon.title = TEXTS[currentLanguage].dragHandle;
      dragIcon.style.cursor = "grab";
      dragIcon.style.display = "inline-block";
      dragIcon.style.padding = "0 0.2em";
      dragIcon.style.fontSize = "1.3em";
      dragIcon.style.color = "#bbb";
      row.appendChild(dragIcon);
      // Color preview
      const colorPreview = document.createElement("span");
      colorPreview.className = "player-color-preview";
      colorPreview.style.display = "inline-block";
      colorPreview.style.width = "1.8em";
      colorPreview.style.height = "1.8em";
      colorPreview.style.borderRadius = "50%";
      colorPreview.style.background = player.color;
      colorPreview.style.border = "2px solid #888";
      colorPreview.style.boxShadow = "0 1px 2px #0002";
      colorPreview.style.marginRight = "0.2em";
      colorPreview.style.cursor = "pointer";
      colorPreview.title = TEXTS[currentLanguage].customize;
      colorPreview.onclick = () => {
        // Paleta de colores popup
        let palette = document.createElement("div");
        palette.className = "color-palette-popup";
        palette.style.position = "absolute";
        palette.style.zIndex = 99999;
        palette.style.background = "#fff";
        palette.style.border = "2px solid #888";
        palette.style.borderRadius = "1em";
        palette.style.padding = "0.3em 0.5em";
        palette.style.boxShadow = "0 2px 8px #0003";
        palette.style.display = "flex";
        palette.style.gap = "0.3em";
        palette.style.top = colorPreview.getBoundingClientRect().top + window.scrollY + 30 + "px";
        palette.style.left = colorPreview.getBoundingClientRect().left + window.scrollX + "px";
        const usedColors = modalPlayers.map((p, i) => (i !== idx ? p.color : null)).filter(Boolean);
        // Only show the current color ONCE, not as both 'used' and 'current'
        palette.innerHTML = PLAYER_COLORS.map((c) => {
          if (c === modalPlayers[idx].color) {
            // show the current color
            return `<span class="color-swatch selected" data-color="${c}" style="background:${c};border-radius:50%;display:inline-block;width:1.5em;height:1.5em;cursor:pointer;border:2px solid #888;"></span>`;
          } else if (!usedColors.includes(c)) {
            return `<span class="color-swatch" data-color="${c}" style="background:${c};border-radius:50%;display:inline-block;width:1.5em;height:1.5em;cursor:pointer;border:2px solid #888;"></span>`;
          } else {
            return "";
          }
        }).join("");
        document.body.appendChild(palette);
        palette.addEventListener("click", (ev) => {
          if (ev.target.classList.contains("color-swatch")) {
            modalPlayers[idx].color = ev.target.getAttribute("data-color");
            if (palette.parentNode) palette.parentNode.removeChild(palette);
            renderModal();
          }
        });
        setTimeout(() => {
          function closePalette(ev) {
            if (!palette.contains(ev.target)) {
              if (palette.parentNode) palette.parentNode.removeChild(palette);
              document.removeEventListener("mousedown", closePalette);
            }
          }
          document.addEventListener("mousedown", closePalette);
        }, 10);
      };
      row.appendChild(colorPreview);
      // Prefijo
      const prefixHtml = document.createElement("span");
      prefixHtml.className = "player-prefix-label";
      prefixHtml.style.display = "inline-block";
      prefixHtml.style.width = "2.5em";
      prefixHtml.style.textAlign = "center";
      prefixHtml.style.fontWeight = "bold";
      prefixHtml.style.color = "#888";
      prefixHtml.textContent = player.defaultName;
      row.appendChild(prefixHtml);
      // Input nombre
      const input = document.createElement("input");
      input.type = "text";
      input.className = "border rounded px-2 py-1 flex-1 text-lg player-name-input";
      input.value = player.name;
      input.maxLength = 16;
      input.autocomplete = "off";
      input.style.minWidth = "0";
      input.style.width = "7em";
      input.oninput = (e) => {
        player.name = e.target.value;
      };
      row.appendChild(input);
      // Botón histórico
      const historyBtn = document.createElement("button");
      historyBtn.className = "name-history-btn";
      historyBtn.title = TEXTS[currentLanguage].customize;
      historyBtn.style.background = "none";
      historyBtn.style.border = "none";
      historyBtn.style.cursor = "pointer";
      historyBtn.style.padding = "0 0.3em";
      historyBtn.style.outline = "none";
      historyBtn.style.fontSize = "1.3em";
      historyBtn.style.verticalAlign = "middle";
      historyBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
      historyBtn.onclick = (e) => {
        // Nombres personalizados en la lista actual (incluye todos los que tengan name, sin exceptuar el actual)
        const custonListNames = modalPlayers.map((p) => p.name).filter(n => n);
        
        // Nombres por defecto base
        let baseDefaults = TEXTS[currentLanguage] && TEXTS[currentLanguage].suggestedPlayerNames ? TEXTS[currentLanguage].suggestedPlayerNames.slice() : [];
        baseDefaults = baseDefaults.filter(n => n && !custonListNames.includes(n));

        // Nombres históricos
        let historic = loadNameHistory().filter(n => n && !baseDefaults.includes(n));
        historic = historic.filter(n => n && !custonListNames.includes(n));

        showNameHistoryModal([...historic,...baseDefaults], new Set(historic), idx);
      };
      row.appendChild(historyBtn);
      container.appendChild(row);
    });
    // Drag & drop
    let dragSrcIdx = null;
    let dragOverIdx = null;
    container.querySelectorAll(".player-row").forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        dragSrcIdx = +row.getAttribute("data-player-idx");
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragSrcIdx);
      });
      row.addEventListener("dragend", (e) => {
        row.classList.remove("dragging");
        container.querySelectorAll(".player-row").forEach((r) => r.classList.remove("drag-over"));
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        dragOverIdx = +row.getAttribute("data-player-idx");
        row.classList.add("drag-over");
      });
      row.addEventListener("dragleave", (e) => {
        row.classList.remove("drag-over");
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const dropIdx = +row.getAttribute("data-player-idx");
        if (dragSrcIdx !== null && dragSrcIdx !== dropIdx) {
          // Sincronizar los inputs actuales con modalPlayers antes de reordenar
          for (let i = 0; i < modalPlayers.length; i++) {
            const input = container.querySelector(`input.player-name-input:nth-of-type(${i+1})`);
            if (input)
              modalPlayers[i].name = input.value.trim();
          }
          const moved = modalPlayers.splice(dragSrcIdx, 1)[0];
          modalPlayers.splice(dropIdx, 0, moved);
          // Ajustar defaultName de todos según su nueva posición
          for (let i = 0; i < modalPlayers.length; i++) {
            modalPlayers[i].defaultName = getDefaultPlayerName(i, currentLanguage);
          }
          renderModal();
        }
        dragSrcIdx = null;
        dragOverIdx = null;
      });
    });
  }

  // Histórico de nombres (modal simple)
  function showNameHistoryModal(historyArr, personalizedSet = new Set(), targetIdx) {
    window._nameHistoryTargetIdx = targetIdx;
    let overlay = document.createElement("div");
    overlay.className = "modal-overlay visible";
    let modal = document.createElement("div");
    modal.className = "unified-modal";
    modal.style.background = "var(--panel-bg)";
    modal.style.border = "4px solid var(--panel-border)";
    modal.style.boxShadow = "0 8px 0px var(--panel-border), 0 12px 20px rgba(0,0,0,0.2)";
    let closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.title = TEXTS[currentLanguage].close;
    closeBtn.className = "modal-close-btn";
    closeBtn.addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
    modal.appendChild(closeBtn);
    let title = document.createElement("h2");
    title.textContent = TEXTS[currentLanguage].nameHistoryTitle;
    title.className = "modal-title";
    modal.appendChild(title);
    let info = document.createElement("div");
    info.textContent = TEXTS[currentLanguage].nameHistoryInfo;
    info.style.textAlign = "center";
    info.style.fontSize = "1.05em";
    info.style.marginBottom = "1.2em";
    info.style.color = "#5a3b2e";
    modal.appendChild(info);
    let content = document.createElement("div");
    content.className = "modal-content";
    content.style.flexWrap = "wrap";
    content.style.flexDirection = "row";
    content.style.justifyContent = "center";
    for (let n of historyArr) {
      let tag = document.createElement("span");
      tag.className = "name-history-tag" + (personalizedSet.has(n) ? " personalized" : "");
      tag.style.display = "inline-flex";
      tag.style.alignItems = "center";
      tag.style.overflow = "hidden";
      tag.style.padding = "0";
      tag.style.margin = "0.25em 0.4em";
      tag.style.borderRadius = "1.2em";
      tag.style.border = personalizedSet.has(n) ? "2px solid #b6d7c9" : "2px solid #e0d9c2";
      tag.style.background = personalizedSet.has(n) ? "#e6f9ed" : "#f3f1ea";
      let namePart = document.createElement("span");
      namePart.textContent = n;
      namePart.style.display = "inline-block";
      namePart.style.verticalAlign = "middle";
      namePart.style.cursor = "pointer";
      namePart.style.padding = "0.25em 1.1em 0.25em 1.1em";
      namePart.style.fontSize = "1.13em";
      namePart.style.color = "#5a3b2e";
      namePart.onclick = (ev) => {
        if (window._nameHistoryTargetIdx !== undefined) {
          const inputs = modalDiv.querySelectorAll("input.player-name-input");
          const input = inputs[window._nameHistoryTargetIdx];
          if (input) {
            input.value = n;
            input.focus();
            modalPlayers[window._nameHistoryTargetIdx].name = n;
          }
        }
        document.body.removeChild(overlay);
        renderModal();
      };
      tag.appendChild(namePart);
      if (personalizedSet.has(n)) {
        let sep = document.createElement("span");
        sep.style.width = "2px";
        sep.style.background = personalizedSet.has(n) ? "#b6d7c9" : "#e0d9c2";
        sep.style.margin = "0";
        sep.style.alignSelf = "stretch";
        let rightPart = document.createElement("span");
        rightPart.style.display = "flex";
        rightPart.style.alignItems = "center";
        rightPart.style.height = "100%";
        rightPart.style.background = "#ffd6d6";
        rightPart.style.borderRadius = "0 1.2em 1.2em 0";
        let trash = document.createElement("button");
        trash.textContent = "✖";
        trash.title = TEXTS[currentLanguage].delete;
        trash.className = "name-history-trash";
        trash.style.background = "transparent";
        trash.style.border = "none";
        trash.style.padding = "0.25em 0.6em 0.25em 0.6em";
        trash.style.margin = "0";
        trash.style.fontSize = "1.3em";
        trash.style.color = "#d00";
        trash.style.cursor = "pointer";
        trash.style.display = "flex";
        trash.style.alignItems = "center";
        trash.style.justifyContent = "center";
        trash.style.transition = "background 0.15s";
        trash.onmouseover = () => { rightPart.style.background = "#ffeaea"; };
        trash.onmouseout = () => { rightPart.style.background = "#ffd6d6"; };
        trash.addEventListener("click", (ev) => {
          ev.stopPropagation();
          showModal({
            title: TEXTS[currentLanguage].delete,
            content: `${TEXTS[currentLanguage].confirmDeleteName}<br><b>"${n}"</b>`,
            buttons: [
              { id: 'cancel', label: TEXTS[currentLanguage].cancel, className: 'btn-red mx-2 px-4' },
              { id: 'ok', label: TEXTS[currentLanguage].ok, className: 'btn-green mx-2 px-4' }
            ],
            onAction: (id) => {
              if (id === 'ok') {
                let arr = loadNameHistory().filter((x) => x !== n);
                saveNameHistory(arr);
                tag.remove();
              }
              // Cierra el modal de confirmación siempre
              return true;
            },
            closeOnEscape: true,
            closeOnBackdrop: true
          });
        });
        rightPart.appendChild(sep);
        rightPart.appendChild(trash);
        tag.appendChild(rightPart);
      }
      content.appendChild(tag);
    }
    modal.appendChild(content);
    let cancelBtn = document.createElement("button");
    cancelBtn.textContent = TEXTS[currentLanguage].cancel;
    cancelBtn.className = "btn btn-red";
    cancelBtn.style.margin = "2em auto 0 auto";
    cancelBtn.style.display = "block";
    cancelBtn.onclick = () => {
      document.body.removeChild(overlay);
    };
    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // --- Render inicial ---
  renderModal();

  // --- Modal principal con showModal ---
  let closeMainModal = null;
  closeMainModal = showModal({
    title: TEXTS[currentLanguage].playerCustomization,
    content: modalDiv,
    buttons: [
      {
        id: "cancel",
        label: TEXTS[currentLanguage].cancel,
        className: "btn-red px-4"
      },
      {
        id: "ok",
        label: TEXTS[currentLanguage].ok,
        className: "btn-green px-4"
      }
    ],
    onAction: (id, event) => {
      if (id === "cancel") {
        if (onCancel) onCancel();
      } else if (id === "ok") {
        // Sincronizar los inputs actuales con modalPlayers
        const inputs = modalDiv.querySelectorAll("input.player-name-input");
        for (let i = 0; i < modalPlayers.length; i++) {
          if (inputs[i]) modalPlayers[i].name = inputs[i].value.trim();
        }
        // Validación de duplicados
        let usedNames = modalPlayers.map((p, i) => p.name || p.defaultName);
        let nameCounts = {};
        for (const n of usedNames) nameCounts[n] = (nameCounts[n] || 0) + 1;
        let duplicates = Object.keys(nameCounts).filter((n) => nameCounts[n] > 1);
        if (duplicates.length > 0) {
          // Modal de advertencia
          // Calculate displayed names for duplicates
          let displayedDuplicates = [];
          for (let i = 0; i < modalPlayers.length; i++) {
            let p = modalPlayers[i];
            let displayName = p.name || p.defaultName;
            if (!duplicates.includes(displayName)) continue;
            displayedDuplicates.push(getDisplayName(p, true));
          }

          showDuplicateNamesModal(displayedDuplicates, () => {
            if (onSave) onSave(modalPlayers);
            if (closeMainModal) closeMainModal();
          });
          return false;
        }
        if (onSave) onSave(modalPlayers);
      }
    }
  });

  // --- Modal de advertencia de duplicados ---
  /**
   * Modal de advertencia de nombres duplicados.
   * @param {Array<string>} duplicates - Nombres duplicados
   * @param {Array<string>} usedNames - Todos los nombres usados
   * @param {Function} [onAccept] - Callback a ejecutar si el usuario acepta duplicados (ejecuta acción del padre)
   */
  function showDuplicateNamesModal(duplicates, onAccept) {
    // Use showModal for duplicate names warning
    const contentDiv = document.createElement("div");
    contentDiv.style.fontSize = "1.2em";
    contentDiv.style.marginBottom = "1em";
    contentDiv.style.maxWidth = "22em";
    contentDiv.style.textAlign = "center";
    contentDiv.innerHTML = `${TEXTS[currentLanguage].duplicateNamesWarning}<br><br>${duplicates.map((n) => `${n}`).join("<br>")}`;

    showModal({
      title: TEXTS[currentLanguage].duplicateNamesTitle,
      content: contentDiv,
      buttons: [
        {
          id: "cancel",
          label: TEXTS[currentLanguage].cancel,
          className: "btn-red px-4"
        },
        {
          id: "accept",
          label: TEXTS[currentLanguage].ok,
          className: "btn-green px-4"
        }
      ],
      onAction: (id, event) => {
        if (id === "cancel") {
          // Just close, let user fix manually
          return;
        } else if (id === "accept") {
          if (typeof onAccept === 'function') {
            onAccept();
          }
        }
      }
    });
  }

  // --- CSS visual para drag-over y dragging ---
  const style = document.createElement("style");
  style.innerHTML = `
    .player-row.drag-over {
      box-shadow: 0 0 0 4px #428BCA, 0 2px 8px #428BCA44;
      background: linear-gradient(90deg, #e6f2fa 80%, #b3e0ff 100%) !important;
      border: 2.5px dashed #428BCA;
      transition: box-shadow 0.15s, background 0.15s, border 0.15s;
      z-index: 2;
      position: relative;
    }
    .player-row.dragging {
      opacity: 0.5;
      z-index: 3;
    }
  `;
  document.head.appendChild(style);
}   