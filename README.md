# NOLAG AntiDump Edge — GitHub + Cloudflare Worker

Worker externo para el hostname del antidump publicado mediante Cloudflare Tunnel.
La Route ejecuta el filtro antes del túnel; las solicitudes permitidas continúan
hacia Nginx/NOLAG mediante `fetch(request)` y mantienen la autorización de sesión.

```text
FiveM / herramienta → Cloudflare Worker → Tunnel → Nginx / NOLAG → FXServer
```

## Publicar en GitHub

Este directorio es un proyecto independiente. Sube **su contenido** a la raíz
del repositorio que conectarás con Cloudflare:

```text
.github/workflows/ci.yml
.gitignore
.dev.vars.example
package.json
package-lock.json
wrangler.jsonc
README.md
src/index.mjs
test/guard.test.mjs
```

Incluye `package-lock.json` para instalaciones reproducibles. Los artefactos
generados y los secretos locales están excluidos por `.gitignore`.

El workflow de GitHub ejecuta pruebas y compila el Worker con Node 22. El
despliegue automático se gestiona desde Workers Builds de Cloudflare.

## Conectar GitHub con Cloudflare

1. En Cloudflare abre **Workers & Pages** y crea/conecta un **Worker** con tu
   repositorio GitHub. Usa el nombre **`nolag-antidump-edge`**, igual al campo
   `name` de `wrangler.jsonc`.
2. Selecciona `main` como rama de producción. Configura:

   | Ajuste | Valor |
   |---|---|
   | Root directory | `/`, si subiste el contenido de este directorio a la raíz |
   | Build command | `npm test` |
   | Deploy command | `npm run deploy` |
   | Node version | `22` (build variable `NODE_VERSION=22`, si hace falta) |

   Si el proyecto está dentro de un monorepo, el Root directory será la ruta
   de este directorio, por ejemplo `/cloudflare-worker`.

3. Despliega. Wrangler aplica la Route que incluye la configuración:

   ```text
   antidump.ciphermode.net/servers/13/files/*
   ```

   En **Settings → Domains & Routes**, confirma esa Route y la zona
   `ciphermode.net`. El patrón cubre HTTP y HTTPS.

4. En **Settings → Variables and Secrets**, añade **`NOLAG_API_KEY` como Secret
   de runtime**. Obtén el valor de **GHOSTNETWORKS → Config FiveM → Config
   Cloudflare** en NOLAG. El Secret autentica los reportes al panel; el filtro
   rechaza el perfil detectado incluso si el reporte no está configurado.

5. Cada push a la rama conectada genera un nuevo despliegue. Las variables de
   host/servidor/URL están versionadas en `wrangler.jsonc`; el Secret se mantiene
   en Cloudflare, fuera del repositorio.

Este proyecto ejecuta un Worker HTTP. En el menú **Workers & Pages** selecciona
el flujo de Worker para que Cloudflare utilice Wrangler y la Route.

## Configuración actual: GHOSTNETWORKS

| Variable | Valor |
|---|---|
| `NOLAG_HOST` | `antidump.ciphermode.net` |
| `NOLAG_SERVER_ID` | `13` |
| `NOLAG_PANEL_URL` | `https://nolag.ciphermode.net` |
| `NOLAG_API_KEY` | Secret añadido en Cloudflare |

Para otro registro, modifica la Route y `NOLAG_SERVER_ID` en `wrangler.jsonc`
y utiliza la API key de ese registro. Cada despliegue de este paquete filtra
el servidor configurado.

El hostname debe seguir apuntando al Tunnel mediante su DNS proxied. La Route
añade el Worker delante del origen existente; utiliza ese mismo hostname y
su zona, sin asignarlo como Custom Domain del Worker. El Tunnel debe estar
activo y NOLAG debe seguir accesible por esa ruta.

## Desarrollo y comprobaciones

Requiere **Node 22 o superior**.

```sh
npm ci
npm test
npm run build
```

`build` valida y empaqueta con Wrangler en modo dry-run. No despliega ni
requiere credenciales de Cloudflare. Para desplegar desde una terminal:

```sh
npx wrangler login
npx wrangler secret put NOLAG_API_KEY
npm run deploy
```

`npm run dev` sirve para revisar la ejecución local. La metadata
`request.cf.clientAcceptEncoding` real procede del edge de Cloudflare: el
tráfico de un servidor local no valida esa detección. Las pruebas unitarias
simulan explícitamente esa metadata y verifican normalización, aislamiento
de rutas, respuestas y reportes.

## Verificación en producción

Después del despliegue:

1. Entra normalmente al servidor con recursos pendientes de descarga.
2. Repite la prueba con la versión Python proporcionada. El perfil detectado
   debe devolver **403** con:

   ```text
   X-Nolag-Edge-Reason: requests_header_profile
   ```

3. Con el Secret configurado, NOLAG recibirá el evento
   `http_client_profile_blocked`. Los reportes tienen cooldown por IP/servidor
   de un minuto por instancia del Worker y no aplican bans automáticos de IP.

Un 403 por falta de token del proxy, sin ese header, no demuestra que este
filtro del edge se haya ejecutado. El archivo de configuración no confirma
por sí solo que la Route esté activa en tu cuenta.

## Alcance

El filtro utiliza la metadata original `request.cf.clientAcceptEncoding`
porque Cloudflare normaliza los headers enviados al Tunnel. Detecta el perfil
por defecto de `requests.Session` de la versión compartida, aunque copie
`CitizenFX/1` y un token válido.

Es una heurística evadible: una herramienta que cambie sus headers puede
superarla. No impide lectura de memoria/caché, no revoca el token del juego
y no cubre descargas que eviten esta Route. No ofrece una garantía de 100%
antidump ni identifica el lenguaje del programa.

## Referencias

- [Workers Builds desde Git](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Tunnel y DNS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Headers originales y normalizados](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
