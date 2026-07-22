# Valeria Rojas

Sitio oficial de Valeria Rojas para `valeriarojas.cl`, basado en Hugo y preparado para publicar con Cloudflare Workers.

Template para sitios Hugo estáticos con:

- Hugo como generador del sitio.
- Cloudflare Workers con assets estáticos.
- Admin custom en `/admin/`.
- Cloudflare Access para proteger `/admin/` y `/api/admin/*`.
- GitHub como almacenamiento de contenido.
- Imágenes en `static/uploads/site`.

> Nota: el nombre del folder pedido es `template-hugo-cloudfare`, pero el producto se llama Cloudflare.

## Estructura

- `src/worker.js`: Worker que sirve el sitio y expone la API del admin.
- `static/admin/`: interfaz del admin y schema editable.
- `static/uploads/site/`: imágenes del sitio.
- `data/settings/global.yml`: ajustes globales editables.
- `content/pages/*.md`: páginas editables.
- `content/pieces/*.md`: colección editable de obras/proyectos.
- `layouts/`: plantillas Hugo.
- `assets/css/main.css`: estilos del sitio.
- `wrangler.toml`: configuración de deploy.

## Configuración Inicial

1. Crea un repo nuevo en GitHub.
2. Copia este template al repo.
3. Cambia `hugo.toml`:

```toml
baseURL = "https://tudominio.com/"
title = "Nombre del sitio"
```

4. Cambia `wrangler.toml`:

```toml
name = "nombre-del-worker"
```

5. En Cloudflare agrega variables/secrets al Worker:

```text
GITHUB_REPO=usuario/repositorio
GITHUB_TOKEN=github_pat_...
CF_ACCESS_TEAM_DOMAIN=tu-team.cloudflareaccess.com
CF_ACCESS_AUDS=audience-tag-de-access
```

`GITHUB_TOKEN` debe ser secreto. Si usas fine-grained token, dale acceso solo a este repositorio y permisos de `Contents: Read and write`.

## Cloudflare Access

Crea una aplicación en Zero Trust para proteger:

```text
https://tudominio.com/admin*
https://tudominio.com/api/admin/*
```

Política recomendada:

- Método: One-time PIN por email.
- Permitir solo emails autorizados.
- Sesión: 12 horas.

El admin no maneja contraseña propia. Cloudflare Access autentica y el Worker valida el JWT de Access antes de aceptar cualquier operación.

## Desarrollo Local

Para ver el sitio:

```bash
hugo server
```

Para probar el Worker:

```bash
hugo --gc --minify
npx wrangler dev
```

En local, si no estás detrás de Cloudflare Access, la API protegida no tendrá `Cf-Access-Jwt-Assertion`. Para probar escritura real en GitHub conviene hacerlo en producción o ajustar temporalmente el Worker con cuidado.

## Deploy

Cloudflare Workers & Pages:

```text
Build command: hugo --gc --minify
Deploy command: npx wrangler deploy
Root directory: /
```

El output estático queda en `public/` y Wrangler lo publica como assets del Worker.

## Admin

El admin está en:

```text
/admin/
```

El schema está en:

```text
static/admin/schema.js
```

Ahí se definen colecciones, campos, labels, páginas editables y el logo del admin.

Desde el resumen del admin se puede activar el modo mantenimiento. Al activarlo,
todo el sitio público queda en blanco después del despliegue, pero `/admin/`
permanece disponible para desactivarlo.

## Personalización

- Cambia colores y layout en `assets/css/main.css`.
- Cambia campos y colecciones en `static/admin/schema.js`.
- Cambia la lista de páginas que carga el Worker en `src/worker.js`.
- Cambia textos iniciales en `content/` y `data/settings/global.yml`.

## Verificación

```bash
node --check src/worker.js
node --check static/admin/admin.js
hugo --gc --minify
```
