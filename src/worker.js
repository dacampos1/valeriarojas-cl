const BRANCH = "main";
const DEFAULT_REPO = "dacampos1/valeriarojas-cl";
const UPLOADS_DIR = "static/uploads/site";

let accessCertsCache = { domain: "", expires: 0, keys: [] };

const PAGES = [
  { id: "home", label: "Inicio", path: "content/_index.md" },
  { id: "about", label: "Sobre", path: "content/pages/about.md" },
  { id: "contact", label: "Contacto", path: "content/pages/contact.md" },
  { id: "works", label: "Obras", path: "content/pieces/_index.md" },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin*") {
      url.pathname = "/admin/";
      return Response.redirect(url.toString(), 302);
    }

    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdminApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleAdminApi(request, env) {
  const route = new URL(request.url).pathname.replace("/api/admin/", "");

  try {
    await requireAccess(request, env);

    if (route === "session" && request.method === "GET") return json({ ok: true });
    if (route === "data" && request.method === "GET") return json(await loadData(env));
    if (route === "save" && request.method === "POST") return json(await saveEntry(env, await request.json()));
    if (route === "piece" && request.method === "POST") return json(await savePiece(env, await request.json()));
    if (route === "delete-piece" && request.method === "POST") return json(await deletePiece(env, await request.json()));
    if (route === "delete-media" && request.method === "POST") return json(await deleteMedia(env, await request.json()));
    if (route === "upload" && request.method === "POST") return json(await upload(env, await request.json()));

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (error) {
    return json({ error: error.message || "Error inesperado" }, error.status || 500);
  }
}

async function requireAccess(request, env) {
  const domain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const audiences = String(env.CF_ACCESS_AUDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!domain || !audiences.length) throw err("Faltan CF_ACCESS_TEAM_DOMAIN o CF_ACCESS_AUDS en Cloudflare.", 500);

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw err("Acceso restringido por Cloudflare Access.", 401);

  const parts = token.split(".");
  if (parts.length !== 3) throw err("Token Access inválido.", 401);

  let header;
  let payload;
  try {
    header = parseJwtPart(parts[0]);
    payload = parseJwtPart(parts[1]);
  } catch {
    throw err("Token Access inválido.", 401);
  }
  if (header.alg !== "RS256" || !header.kid) throw err("Token Access inválido.", 401);

  const keys = await getAccessKeys(domain);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw err("No se encontró la llave de Cloudflare Access.", 401);

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!validSignature) throw err("Firma Access inválida.", 401);

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) throw err("Sesión Access expirada.", 401);
  if (payload.nbf && payload.nbf > now) throw err("Sesión Access inválida.", 401);
  if (getIssuerHost(payload.iss) !== domain) throw err("Emisor Access inválido.", 401);

  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.some((audience) => tokenAudiences.includes(audience))) {
    throw err("Audience Access inválida.", 401);
  }
}

async function getAccessKeys(domain) {
  if (accessCertsCache.domain === domain && accessCertsCache.expires > Date.now()) {
    return accessCertsCache.keys;
  }

  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  const certs = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(certs.keys)) throw err("No se pudieron cargar las llaves de Cloudflare Access.", 500);

  accessCertsCache = {
    domain,
    expires: Date.now() + 60 * 60 * 1000,
    keys: certs.keys,
  };
  return certs.keys;
}

function normalizeTeamDomain(value) {
  return String(value || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function getIssuerHost(value) {
  try {
    return new URL(String(value || "")).hostname;
  } catch {
    return "";
  }
}

function parseJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function loadData(env) {
  const [settings, pieceList, mediaList, ...pages] = await Promise.all([
    ghGet(env, "data/settings/global.yml"),
    ghList(env, "content/pieces"),
    ghList(env, UPLOADS_DIR),
    ...PAGES.map(async (page) => {
      const file = await ghGet(env, page.path);
      return { ...page, sha: file.sha, ...parseMd(file.content) };
    }),
  ]);

  const pieces = await Promise.all(
    pieceList
      .filter((item) => item.name.endsWith(".md") && item.name !== "_index.md")
      .map(async (item) => {
        const file = await ghGet(env, item.path);
        return { path: item.path, sha: file.sha, ...parseMd(file.content) };
      }),
  );

  pieces.sort((a, b) => String(b.frontmatter.date || "").localeCompare(String(a.frontmatter.date || "")));

  const usedAssets = collectUsedAssetsFromEntries(parseYaml(settings.content), pages, pieces);
  const media = mediaList
    .filter((item) => item.type === "file")
    .map((item) => {
      const url = `/${item.path.replace(/^static\//, "")}`;
      return {
        name: item.name,
        path: item.path,
        url,
        sha: item.sha,
        size: item.size || 0,
        used: usedAssets.has(url),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    settings: { path: "data/settings/global.yml", sha: settings.sha, values: parseYaml(settings.content) },
    pages,
    pieces,
    media,
  };
}

async function saveEntry(env, payload) {
  if (!payload.path) throw err("Falta archivo", 400);
  const content = payload.path.endsWith(".yml")
    ? stringifyYaml(payload.values || {})
    : stringifyMd(payload.frontmatter || {}, payload.body || "");

  const uploads = uploadFilesFromPayload(payload.uploads);
  if (uploads.length) {
    await ghCommitFiles(env, [
      ...uploads,
      { path: payload.path, content, encoding: "utf-8" },
    ], `Admin: actualizar ${payload.path}`);
    return { ok: true };
  }

  await ghPut(env, payload.path, content, payload.sha, `Admin: actualizar ${payload.path}`);
  return { ok: true };
}

async function savePiece(env, payload) {
  const title = payload.frontmatter?.title || "obra";
  const path = payload.path || `content/pieces/${slugify(title)}.md`;
  const content = stringifyMd(payload.frontmatter || {}, payload.body || "");
  const uploads = uploadFilesFromPayload(payload.uploads);

  if (uploads.length) {
    await ghCommitFiles(env, [
      ...uploads,
      { path, content, encoding: "utf-8" },
    ], `Admin: guardar ${title}`);
    return { ok: true, path };
  }

  await ghPut(env, path, content, payload.sha, `Admin: guardar ${title}`);
  return { ok: true, path };
}

async function deletePiece(env, payload) {
  if (!payload.path || !payload.path.startsWith("content/pieces/") || payload.path.endsWith("_index.md")) {
    throw err("Obra inválida", 400);
  }
  const file = await ghGet(env, payload.path);
  const piece = parseMd(file.content);
  const candidateAssets = collectUploadPaths(piece);

  await ghDelete(env, payload.path, file.sha, `Admin: eliminar ${payload.path}`);

  const deletedAssets = await deleteUnusedAssets(env, candidateAssets, payload.path);
  return { ok: true, deletedAssets };
}

async function deleteMedia(env, payload) {
  const path = String(payload.path || "");
  if (!path.startsWith(`${UPLOADS_DIR}/`) || path.includes("..")) throw err("Archivo inválido", 400);

  const asset = normalizeUploadPath(path);
  const usedAssets = await collectUsedAssets(env);
  if (usedAssets.has(asset)) throw err("Ese archivo está en uso. Sácalo primero de la obra, página o ajuste donde aparece.", 409);

  const file = await ghGetMetadata(env, path);
  await ghDelete(env, path, file.sha, `Admin: eliminar archivo ${asset}`);
  return { ok: true, deletedAsset: asset };
}

async function upload(env, payload) {
  const match = String(payload.dataUrl || "").match(/^data:[^;]+;base64,(.+)$/);
  if (!match) throw err("Imagen inválida", 400);

  const filename = sanitizeFilename(payload.filename || "imagen.jpg");
  const extension = filename.split(".").pop() || "jpg";
  const base = filename.replace(/\.[^.]+$/, "");
  const path = `${UPLOADS_DIR}/${slugify(base)}-${Date.now()}.${extension.toLowerCase()}`;

  await ghPut(env, path, match[1], null, `Admin: subir ${filename}`, true);
  return { ok: true, url: path.replace(/^static/, "") };
}

async function ghGet(env, path) {
  const data = await gh(env, `/contents/${path}?ref=${BRANCH}`);
  return { sha: data.sha, content: decodeBase64(data.content || "") };
}

async function ghGetMetadata(env, path) {
  const data = await gh(env, `/contents/${path}?ref=${BRANCH}`);
  return { sha: data.sha };
}

async function ghList(env, path) {
  const data = await gh(env, `/contents/${path}?ref=${BRANCH}`);
  if (!Array.isArray(data)) throw err(`No se pudo listar ${path}`, 500);
  return data;
}

async function ghPut(env, path, content, sha, message, alreadyBase64 = false) {
  return gh(env, `/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      branch: BRANCH,
      message,
      content: alreadyBase64 ? content : encodeBase64(content),
      ...(sha ? { sha } : {}),
    }),
  });
}

async function ghCommitFiles(env, files, message) {
  const ref = await gh(env, `/git/ref/heads/${BRANCH}`);
  const baseCommit = await gh(env, `/git/commits/${ref.object.sha}`);
  const treeItems = await Promise.all(files.map(async (file) => {
    const blob = await gh(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify({ content: file.content, encoding: file.encoding || "utf-8" }),
    });
    return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await gh(env, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
  });
  const commit = await gh(env, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }),
  });
  await gh(env, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
}

async function ghDelete(env, path, sha, message) {
  return gh(env, `/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({ branch: BRANCH, message, sha }),
  });
}

async function gh(env, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || DEFAULT_REPO}${path}`, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "hugo-cloudflare-admin",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw err(data.message || `GitHub ${response.status}`, response.status);
  return data;
}

function uploadFilesFromPayload(uploads = []) {
  if (!Array.isArray(uploads)) return [];

  return uploads.map((upload) => {
    const path = String(upload.path || "");
    const match = String(upload.dataUrl || "").match(/^data:[^;]+;base64,(.+)$/);
    if (!path.startsWith(`${UPLOADS_DIR}/`) || path.includes("..")) throw err("Archivo inválido", 400);
    if (!match) throw err("Imagen inválida", 400);
    return { path, content: match[1], encoding: "base64" };
  });
}

async function deleteUnusedAssets(env, candidates, excludePath) {
  const assets = [...new Set(candidates.map(normalizeUploadPath).filter(Boolean))];
  if (!assets.length) return [];

  const usedAssets = await collectUsedAssets(env, excludePath);
  const deletedAssets = [];

  for (const asset of assets) {
    if (usedAssets.has(asset)) continue;

    const path = `static${asset}`;
    try {
      const file = await ghGetMetadata(env, path);
      await ghDelete(env, path, file.sha, `Admin: eliminar imagen ${asset}`);
      deletedAssets.push(asset);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  return deletedAssets;
}

async function collectUsedAssets(env, excludePath) {
  const usedAssets = new Set();
  const remember = (content) => collectUploadPaths(content).forEach((asset) => usedAssets.add(asset));

  const settings = await ghGet(env, "data/settings/global.yml");
  remember(parseYaml(settings.content));

  await Promise.all(PAGES.map(async (page) => {
    const file = await ghGet(env, page.path);
    remember(parseMd(file.content));
  }));

  const pieces = await ghList(env, "content/pieces");
  await Promise.all(
    pieces
      .filter((item) => item.name.endsWith(".md") && item.name !== "_index.md" && item.path !== excludePath)
      .map(async (item) => {
        const file = await ghGet(env, item.path);
        remember(parseMd(file.content));
      }),
  );

  return usedAssets;
}

function collectUsedAssetsFromEntries(settings, pages, pieces) {
  const usedAssets = new Set();
  [settings, ...pages, ...pieces].forEach((entry) => {
    collectUploadPaths(entry).forEach((asset) => usedAssets.add(asset));
  });
  return usedAssets;
}

function collectUploadPaths(value) {
  const paths = [];

  const walk = (item) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(/(?:static)?\/uploads\/site\/[^\s"'`)]+/g)) {
        const path = normalizeUploadPath(match[0]);
        if (path) paths.push(path);
      }
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }

    if (item && typeof item === "object") {
      Object.values(item).forEach(walk);
    }
  };

  walk(value);
  return paths;
}

function normalizeUploadPath(value) {
  const path = String(value || "").trim().replace(/^https?:\/\/[^/]+/, "").replace(/^static/, "");
  if (!path.startsWith("/uploads/site/")) return "";
  if (path.includes("..")) return "";
  return path;
}

function parseMd(content) {
  const match = String(content || "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content || "" };
  return { frontmatter: parseYaml(match[1]), body: match[2].trim() };
}

function stringifyMd(frontmatter, body) {
  return `---\n${stringifyYaml(frontmatter)}---\n\n${String(body || "").trim()}\n`;
}

function parseYaml(source) {
  const lines = String(source || "").split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (line.startsWith("- ")) {
      if (!Array.isArray(parent)) continue;
      const text = line.slice(2);
      if (text.includes(":")) {
        const item = {};
        parent.push(item);
        stack.push({ indent, value: item });
        const [key, ...rest] = text.split(":");
        item[key.trim()] = parseScalar(rest.join(":").trim());
      } else {
        parent.push(parseScalar(text));
      }
      continue;
    }

    const [key, ...rest] = line.split(":");
    const name = key.trim();
    const value = rest.join(":").trim();
    if (!name) continue;

    if (value === "") {
      const next = lines.slice(i + 1).find((candidate) => candidate.trim());
      const container = next && next.trim().startsWith("- ") ? [] : {};
      parent[name] = container;
      stack.push({ indent, value: container });
    } else {
      parent[name] = parseScalar(value);
    }
  }

  return root;
}

function stringifyYaml(value, indent = 0) {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (!value.length) return "[]\n";
    return value.map((item) => {
      if (item && typeof item === "object") {
        const nested = stringifyYaml(item, indent + 2).trimEnd().split("\n");
        const itemIndent = indent + 2;
        const rest = nested.slice(1).map((line) => {
          const relative = line.startsWith(" ".repeat(itemIndent)) ? line.slice(itemIndent) : line.trimStart();
          return `${pad}  ${relative}`;
        });
        return `${pad}- ${nested[0].trimStart()}${rest.length ? `\n${rest.join("\n")}` : ""}`;
      }
      return `${pad}- ${formatScalar(item)}`;
    }).join("\n") + "\n";
  }

  return Object.entries(value || {})
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => {
      if (Array.isArray(item)) {
        if (!item.length) return `${pad}${key}: []`;
        return `${pad}${key}:\n${stringifyYaml(item, indent + 2).trimEnd()}`;
      }
      if (item && typeof item === "object") {
        return `${pad}${key}:\n${stringifyYaml(item, indent + 2).trimEnd()}`;
      }
      return `${pad}${key}: ${formatScalar(item)}`;
    })
    .join("\n") + "\n";
}

function parseScalar(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"');
  }
  return value;
}

function formatScalar(value) {
  if (value === true || value === false) return String(value);
  if (value === null || value === undefined || value === "") return '""';
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value) {
  return decodeURIComponent(escape(atob(String(value).replace(/\n/g, ""))));
}

function slugify(value) {
  return String(value || "obra")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "obra";
}

function sanitizeFilename(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function err(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
