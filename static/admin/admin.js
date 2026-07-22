(function () {
  const schema = window.ADMIN_SCHEMA;
  const app = document.querySelector("#app");
  const state = { data: null, view: "dashboard", collection: null, entry: null, pendingPreviews: loadPendingPreviews() };

  const api = async (path, options = {}) => {
    const response = await fetch(`/api/admin/${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Admin API ${response.status}`);
    return data;
  };

  boot();

  async function boot() {
    renderLogin("Verificando acceso...");
    try {
      await api("session");
      await loadData();
      renderShell();
    } catch (error) {
      renderLogin(error.message || "No se pudo verificar el acceso.");
    }
  }

  async function loadData() {
    state.data = await api("data");
  }

  function renderLogin(message) {
    app.innerHTML = `
      <section class="login">
        <div class="login-card">
          <strong class="brand-title">${esc(schema.brand.title)}</strong>
          <img class="brand-logo" src="${escAttr(schema.brand.logo)}" alt="">
          <span class="brand-subtitle">${esc(schema.brand.subtitle)}</span>
          <p class="notice">${esc(message)}</p>
        </div>
      </section>`;
  }

  function renderShell() {
    app.innerHTML = `
      <div class="shell">
        <aside>
          <div class="side-brand">
            <img src="${escAttr(schema.brand.logo)}" alt="">
            <div><strong>${esc(schema.brand.title)}</strong><div class="muted">Administración</div></div>
          </div>
          <nav>
            <button class="nav-button" data-view="dashboard">Resumen</button>
            ${schema.collections.map((collection) => `<button class="nav-button" data-collection="${escAttr(collection.name)}">${esc(collection.label)}</button>`).join("")}
            <button class="nav-button" data-view="media">Medios</button>
            <button class="nav-button" data-view="logout">Salir</button>
          </nav>
        </aside>
        <main>
          <div class="topbar">
            <div>
              <p class="muted">Administración</p>
              <h1 id="page-title"></h1>
            </div>
            <div class="actions" id="top-actions"></div>
          </div>
          <p id="message" class="notice" role="status" aria-live="polite" hidden></p>
          <section id="content"></section>
        </main>
      </div>`;

    app.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.view === "logout") {
          return location.assign(`/cdn-cgi/access/logout?returnTo=${encodeURIComponent(`${location.origin}/`)}`);
        }
        state.view = button.dataset.view;
        state.collection = null;
        state.entry = null;
        setMessage("");
        renderCurrent();
      });
    });

    app.querySelectorAll("[data-collection]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = "collection";
        state.collection = getCollection(button.dataset.collection);
        state.entry = null;
        setMessage("");
        renderCurrent();
      });
    });

    renderCurrent();
  }

  function renderCurrent() {
    app.querySelectorAll(".nav-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.view || button.dataset.collection === state.collection?.name);
    });

    if (state.view === "dashboard") return renderDashboard();
    if (state.view === "media") return renderMedia();
    if (state.view === "collection") return state.entry ? renderEditor() : renderCollection();
  }

  function renderDashboard() {
    const maintenanceMode = state.data.settings.values.maintenance_mode === true;
    setTitle("Resumen");
    setActions(`<a class="button secondary" href="/" target="_blank" rel="noopener">Ver sitio</a>`);
    content().innerHTML = `
      <div class="grid">
        <div class="card"><h2>${state.data.pieces.length}</h2><p class="muted">Obras cargadas</p></div>
        <div class="card"><h2>${state.data.pages.length}</h2><p class="muted">Páginas editables</p></div>
        <div class="card"><h2>${state.data.media.length}</h2><p class="muted">Archivos en medios</p></div>
        <div class="card span-2">
          <h3>Modo mantenimiento</h3>
          <p class="muted">${maintenanceMode ? "El sitio público está mostrando la página de mantenimiento." : "El sitio público está visible."}</p>
          <button class="button ${maintenanceMode ? "accent" : "danger"}" id="toggle-maintenance">
            ${maintenanceMode ? "Volver a mostrar el sitio" : "Dejar sitio en mantenimiento"}
          </button>
        </div>
        <div class="card span-2"><h3>Publicación</h3><p class="muted">Los cambios pueden tardar unos minutos en aparecer en el sitio.</p></div>
      </div>`;

    app.querySelector("#toggle-maintenance").addEventListener("click", async (event) => {
      const nextMode = !maintenanceMode;
      if (nextMode && !confirm("¿Dejar el sitio en mantenimiento? El contenido público será reemplazado por un aviso hasta que vuelvas a mostrarlo desde aquí.")) return;

      const button = event.currentTarget;
      try {
        button.disabled = true;
        button.textContent = nextMode ? "Ocultando sitio..." : "Mostrando sitio...";
        setMessage("Guardando el cambio en GitHub...");
        await api("save", {
          method: "POST",
          body: JSON.stringify({
            path: state.data.settings.path,
            sha: state.data.settings.sha,
            values: { ...state.data.settings.values, maintenance_mode: nextMode },
          }),
        });
        await loadData();
        renderDashboard();
        setMessage(nextMode
          ? "Modo mantenimiento activado. El aviso aparecerá cuando termine el despliegue."
          : "Modo mantenimiento desactivado. El sitio volverá a mostrarse cuando termine el despliegue.", "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = maintenanceMode ? "Volver a mostrar el sitio" : "Dejar sitio en mantenimiento";
        setMessage(`No se pudo cambiar el modo mantenimiento: ${error.message}`, "error");
      }
    });
  }

  function renderCollection() {
    const collection = state.collection;
    setTitle(collection.label);
    setActions(collection.type === "folder"
      ? `<button class="button accent" id="new-entry">Nueva ${esc(collection.singular || collection.label)}</button>`
      : `<a class="button secondary" href="/" target="_blank" rel="noopener">Ver sitio</a>`);

    if (collection.type === "file") {
      state.entry = {
        type: "file",
        collection,
        path: collection.path,
        sha: state.data[collection.dataKey].sha,
        data: { ...state.data[collection.dataKey].values },
        uploads: [],
      };
      return renderEditor();
    }

    const entries = getEntries(collection);
    content().innerHTML = `<div class="stack">${entries.map((entry, index) => entryRow(collection, entry, index)).join("")}</div>`;
    content().querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        state.entry = prepareEntry(collection, entries[Number(button.dataset.edit)]);
        setMessage("");
        renderEditor();
      });
    });

    app.querySelector("#new-entry")?.addEventListener("click", () => {
      state.entry = prepareNewEntry(collection);
      setMessage("");
      renderEditor();
    });
  }

  function entryRow(collection, entry, index) {
    const data = entryData(entry);
    const title = data.title || entry.label || entry.path || "Sin título";
    const subtitle = collection.summary?.map((field) => data[field]).filter(Boolean).join(" - ") || entry.path || "";
    const image = data[collection.thumbnail || "image"];
    return `
      <div class="row">
        <div class="row-title">
          ${image ? `<img src="${escAttr(previewSrc(image))}" alt="">` : ""}
          <div><strong>${esc(title)}</strong><span class="muted">${esc(subtitle)}</span></div>
        </div>
        <button class="button secondary" data-edit="${index}">Editar</button>
      </div>`;
  }

  function renderEditor() {
    const { collection, data } = state.entry;
    const title = data.title || state.entry.label || collection.label;
    setTitle(title);
    setActions(`<button class="button secondary" id="back">Volver</button>`);

    content().innerHTML = `
      <form id="entry-form" class="grid">
        ${fieldsFor(state.entry).map((field) => renderField(field, data[field.name], field.name)).join("")}
        <div class="actions span-2">
          <button class="button accent">Guardar</button>
          ${collection.type === "folder" && state.entry.path ? `<button class="button danger" type="button" id="delete-entry">Eliminar</button>` : ""}
        </div>
      </form>`;

    hydrateFieldEvents(content(), state.entry.data);

    app.querySelector("#back").addEventListener("click", () => {
      state.entry = null;
      renderCurrent();
    });

    app.querySelector("#delete-entry")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const entryTitle = state.entry.data.title || "esta obra";
      if (!confirm(`¿Eliminar “${entryTitle}”? Esta acción no se puede deshacer.`)) return;
      try {
        button.disabled = true;
        button.textContent = "Eliminando...";
        setMessage(`Eliminando “${entryTitle}”…`);
        await api("delete-piece", { method: "POST", body: JSON.stringify({ path: state.entry.path }) });
        await loadData();
        state.entry = null;
        renderCurrent();
        setMessage(`“${entryTitle}” fue eliminada correctamente. El cambio puede tardar unos minutos en aparecer en el sitio.`, "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Eliminar";
        setMessage(`No se pudo eliminar “${entryTitle}”: ${error.message}`, "error");
      }
    });

    app.querySelector("#entry-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector("button[type='submit'], button:not([type])");
      try {
        submit.disabled = true;
        submit.textContent = "Guardando...";
        setMessage(state.entry.uploads?.length ? "Guardando imagen y contenido en GitHub..." : "Guardando en GitHub...");
        const data = readFields(fieldsFor(state.entry), form);
        await saveEntry(data);
      } catch (error) {
          setMessage(`No se pudo guardar: ${error.message}`, "error");
        submit.disabled = false;
        submit.textContent = "Guardar";
      }
    });
  }

  async function saveEntry(data) {
    const entry = state.entry;
    const body = data.body || "";
    delete data.body;

    if (entry.collection.type === "folder") {
      await api("piece", {
        method: "POST",
        body: JSON.stringify({ path: entry.path, sha: entry.sha, frontmatter: data, body, uploads: entry.uploads || [] }),
      });
    } else if (entry.path.endsWith(".yml")) {
      await api("save", {
        method: "POST",
        body: JSON.stringify({ path: entry.path, sha: entry.sha, values: data, uploads: entry.uploads || [] }),
      });
    } else {
      await api("save", {
        method: "POST",
        body: JSON.stringify({ path: entry.path, sha: entry.sha, frontmatter: data, body, uploads: entry.uploads || [] }),
      });
    }

    await refresh("Guardado en GitHub. Los cambios pueden tardar unos minutos en aparecer en el sitio.");
    state.entry = null;
    renderCurrent();
  }

  function renderMedia() {
    setTitle("Medios");
    setActions(`<a class="button secondary" href="/" target="_blank" rel="noopener">Ver sitio</a>`);
    content().innerHTML = `
      <div class="card stack">
        <h3>Subir archivo</h3>
        <div class="actions">
          <input id="media-file" type="file" accept="image/*">
          <button class="button secondary" id="upload-media">Subir a medios</button>
        </div>
      </div>
      <div class="media-grid">
        ${state.data.media.map((item) => `
          <div class="media-card">
            <img src="${escAttr(item.url)}" alt="">
            <strong>${esc(item.name)}</strong>
            <span class="pill ${item.used ? "used" : ""}">${item.used ? "En uso" : "Sin uso"}</span>
            <code>${esc(item.url)}</code>
            <div class="actions">
              <button class="button secondary" data-copy="${escAttr(item.url)}">Copiar URL</button>
              <button class="button danger" data-delete-media="${escAttr(item.path)}" ${item.used ? "disabled" : ""}>Eliminar</button>
            </div>
          </div>`).join("")}
      </div>`;

    app.querySelector("#upload-media").addEventListener("click", async () => {
      try {
        const url = await uploadMediaFile(app.querySelector("#media-file"));
        if (url) await refresh("Archivo subido. Los cambios pueden tardar unos minutos en aparecer.");
        renderMedia();
      } catch (error) {
        setMessage(`No se pudo subir el archivo: ${error.message}`);
      }
    });

    content().querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.dataset.copy);
        setMessage("URL copiada.");
      });
    });

    content().querySelectorAll("[data-delete-media]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este archivo?")) return;
        try {
          setMessage("Eliminando archivo...");
          await api("delete-media", { method: "POST", body: JSON.stringify({ path: button.dataset.deleteMedia }) });
          await refresh("Archivo eliminado. Los cambios pueden tardar unos minutos en aparecer.");
          renderMedia();
        } catch (error) {
          setMessage(`No se pudo eliminar el archivo: ${error.message}`, "error");
        }
      });
    });
  }

  function renderField(field, value, path) {
    if (field.widget === "hidden") {
      return `<input type="hidden" name="${escAttr(path)}" value="${escAttr(value ?? field.default ?? "")}">`;
    }

    if (field.widget === "text" || field.widget === "markdown") {
      return `<label class="span-2">${esc(field.label)}<textarea class="${field.widget === "markdown" ? "markdown" : ""}" name="${escAttr(path)}">${esc(value || "")}</textarea></label>`;
    }

    if (field.widget === "select") {
      return `<label>${esc(field.label)}<select name="${escAttr(path)}">${(field.options || []).map((option) => {
        const item = typeof option === "string" ? { label: option, value: option } : option;
        return `<option value="${escAttr(item.value)}" ${String(value) === String(item.value) ? "selected" : ""}>${esc(item.label)}</option>`;
      }).join("")}</select></label>`;
    }

    if (field.widget === "boolean") {
      return `<label>${esc(field.label)}<select name="${escAttr(path)}"><option value="false" ${!value ? "selected" : ""}>No</option><option value="true" ${value ? "selected" : ""}>Sí</option></select></label>`;
    }

    if (field.widget === "image") {
      const positionPath = path === "image" ? "image_position" : path.replace(/\.image$/, ".position");
      return `
        <label class="image-field">${esc(field.label)}
          ${value ? `<div class="field-image-frame" data-crop-frame data-position-for="${escAttr(positionPath)}"><img class="field-image-preview" src="${escAttr(previewSrc(value))}" alt=""></div>` : ""}
          <input name="${escAttr(path)}" value="${escAttr(value || "")}">
          <div class="actions"><input type="file" accept="image/*" data-upload-for="${escAttr(path)}"><button class="button secondary" type="button" data-upload-button="${escAttr(path)}">Preparar imagen</button></div>
          <span class="field-hint">Arrastra la vista previa para ajustar el encuadre. La imagen se publica al guardar.</span>
        </label>`;
    }

    if (field.widget === "list") {
      const items = Array.isArray(value) ? value : [];
      return `
        <div class="span-2 list-field" data-list="${escAttr(path)}">
          <h3>${esc(field.label)}</h3>
          <div class="stack" data-list-items="${escAttr(path)}">
            ${items.map((item, index) => renderListItem(field, item, path, index)).join("")}
          </div>
          <button class="button secondary" type="button" data-add-list="${escAttr(path)}">Agregar</button>
        </div>`;
    }

    return `<label>${esc(field.label)}<input name="${escAttr(path)}" value="${escAttr(value || field.default || "")}"></label>`;
  }

  function renderListItem(field, item, path, index) {
    return `
      <div class="list-entry" data-list-entry="${escAttr(path)}">
        <div class="grid">
          ${field.fields.map((subfield) => renderField(subfield, item?.[subfield.name], `${path}.${index}.${subfield.name}`)).join("")}
        </div>
        <button class="button danger" type="button" data-remove-list-item>Quitar</button>
      </div>`;
  }

  function hydrateFieldEvents(root) {
    root.querySelectorAll("[data-upload-button]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const name = button.dataset.uploadButton;
          const input = root.querySelector(`[data-upload-for="${cssEscape(name)}"]`);
          const url = await queueImageFile(input);
          if (!url) return;
          const target = root.querySelector(`[name="${cssEscape(name)}"]`);
          target.value = url;
          updateImagePreview(target, url);
          hydrateCropFrames(target.closest("label"));
          setMessage("Imagen lista como vista previa. Ahora aprieta Guardar para publicarla con los cambios.");
        } catch (error) {
          setMessage(`No se pudo preparar la imagen: ${error.message}`);
        }
      });
    });

    root.querySelectorAll("[data-add-list]").forEach((button) => {
      button.addEventListener("click", () => {
        const listPath = button.dataset.addList;
        const field = findField(fieldsFor(state.entry), listPath);
        const container = root.querySelector(`[data-list-items="${cssEscape(listPath)}"]`);
        const index = container.querySelectorAll("[data-list-entry]").length;
        container.insertAdjacentHTML("beforeend", renderListItem(field, {}, listPath, index));
        hydrateFieldEvents(container.lastElementChild);
      });
    });

    root.querySelectorAll("[data-remove-list-item]").forEach((button) => {
      button.addEventListener("click", () => button.closest("[data-list-entry]").remove());
    });
    hydrateCropFrames(root);
  }

  function hydrateCropFrames(root) {
    root.querySelectorAll("[data-crop-frame]:not([data-crop-ready])").forEach((frame) => {
      frame.dataset.cropReady = "true";
      const positionInput = content().querySelector(`[name="${cssEscape(frame.dataset.positionFor)}"]`);
      let [x, y] = parsePosition(positionInput?.value);
      const paint = () => {
        frame.querySelector("img").style.objectPosition = `${x}% ${y}%`;
        if (positionInput) positionInput.value = `${Math.round(x)}% ${Math.round(y)}%`;
      };
      paint();
      frame.addEventListener("pointerdown", (event) => {
        frame.setPointerCapture(event.pointerId);
        const move = (pointer) => {
          const rect = frame.getBoundingClientRect();
          x = Math.max(0, Math.min(100, ((pointer.clientX - rect.left) / rect.width) * 100));
          y = Math.max(0, Math.min(100, ((pointer.clientY - rect.top) / rect.height) * 100));
          paint();
        };
        move(event);
        frame.addEventListener("pointermove", move);
        frame.addEventListener("pointerup", () => frame.removeEventListener("pointermove", move), { once: true });
      });
    });
  }

  function parsePosition(value) {
    const match = String(value || "50% 50%").match(/([\d.]+)%\s+([\d.]+)%/);
    return match ? [Number(match[1]), Number(match[2])] : [50, 50];
  }

  function readFields(fields, form) {
    const data = {};
    fields.forEach((field) => readField(field, field.name, form, data));
    return data;
  }

  function readField(field, path, form, target) {
    if (field.widget === "list") {
      target[field.name] = [];
      form.querySelectorAll(`[data-list-entry="${cssEscape(path)}"]`).forEach((entry) => {
        const item = {};
        field.fields.forEach((subfield) => {
          const input = entry.querySelector(`[name$=".${cssEscape(subfield.name)}"]`);
          item[subfield.name] = parseValue(subfield, input?.value ?? "");
        });
        target[field.name].push(item);
      });
      return;
    }

    const input = form.querySelector(`[name="${cssEscape(path)}"]`);
    target[field.name] = parseValue(field, input?.value ?? field.default ?? "");
  }

  function parseValue(field, value) {
    if (field.widget === "boolean") return value === "true";
    return value;
  }

  async function queueImageFile(input) {
    const file = input?.files?.[0];
    if (!file) return setMessage("Elige una imagen primero."), "";
    const dataUrl = await readFile(file);
    const filename = sanitizeFilename(file.name || "imagen.jpg");
    const extension = filename.split(".").pop() || "jpg";
    const base = filename.replace(/\.[^.]+$/, "");
    const path = `static/uploads/site/${slugify(base)}-${Date.now()}.${extension.toLowerCase()}`;
    state.entry.uploads = [...(state.entry.uploads || []), { path, dataUrl, filename }];
    state.pendingPreviews[path.replace(/^static/, "")] = dataUrl;
    savePendingPreviews();
    return path.replace(/^static/, "");
  }

  async function uploadMediaFile(input) {
    const file = input?.files?.[0];
    if (!file) return setMessage("Elige una imagen primero."), "";
    setMessage("Subiendo imagen...");
    const dataUrl = await readFile(file);
    const result = await api("upload", { method: "POST", body: JSON.stringify({ filename: file.name, dataUrl }) });
    return result.url;
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function refresh(message) {
    await loadData();
    setMessage(message);
  }

  function getCollection(name) {
    return schema.collections.find((collection) => collection.name === name);
  }

  function getEntries(collection) {
    if (collection.type === "files") return collection.files.map((file) => {
      const entry = state.data[collection.dataKey].find((item) => item.path === file.path);
      return { ...entry, label: file.label, file };
    });
    return state.data[collection.dataKey] || [];
  }

  function prepareEntry(collection, entry) {
    return {
      collection,
      path: entry.path,
      sha: entry.sha,
      label: entry.label,
      file: entry.file,
      data: entryData(entry),
      uploads: [],
    };
  }

  function prepareNewEntry(collection) {
    const data = {};
    collection.fields.forEach((field) => data[field.name] = field.default ?? (field.widget === "list" ? [] : ""));
    data.date = data.date || new Date().toISOString().slice(0, 10);
    return { collection, path: "", sha: "", data, uploads: [] };
  }

  function entryData(entry) {
    return { ...(entry.frontmatter || entry.data || {}), ...(entry.body ? { body: entry.body } : {}) };
  }

  function fieldsFor(entry) {
    return entry.file?.fields || entry.collection.fields || [];
  }

  function findField(fields, name) {
    return fields.find((field) => field.name === name);
  }

  function setTitle(title) {
    app.querySelector("#page-title").textContent = title;
  }

  function setActions(html) {
    app.querySelector("#top-actions").innerHTML = html;
  }

  function setMessage(message, type = "info") {
    const element = app.querySelector("#message");
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.className = `notice ${type}`;
  }

  function content() {
    return app.querySelector("#content");
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function updateImagePreview(input, url) {
    const label = input.closest("label");
    const preview = label?.querySelector(".field-image-preview");
    if (preview) {
      preview.src = previewSrc(url);
      return;
    }
    const positionPath = input.name === "image" ? "image_position" : input.name.replace(/\.image$/, ".position");
    input.insertAdjacentHTML("beforebegin", `<div class="field-image-frame" data-crop-frame data-position-for="${escAttr(positionPath)}"><img class="field-image-preview" src="${escAttr(previewSrc(url))}" alt=""></div>`);
  }

  function previewSrc(url) {
    return state.pendingPreviews[url] || url;
  }

  function loadPendingPreviews() {
    try {
      return JSON.parse(localStorage.getItem("hugo_cloudflare_admin_pending_previews") || "{}");
    } catch {
      return {};
    }
  }

  function savePendingPreviews() {
    try {
      localStorage.setItem("hugo_cloudflare_admin_pending_previews", JSON.stringify(state.pendingPreviews));
    } catch {
      // Best effort only: previews are cosmetic and should never block saving.
    }
  }

  function sanitizeFilename(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
  }

  function slugify(value) {
    return String(value || "imagen")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "imagen";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function escAttr(value) {
    return esc(value).replace(/`/g, "&#096;");
  }
})();
