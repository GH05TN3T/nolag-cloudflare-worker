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

Workers Builds ejecuta las pruebas de este repositorio con Node 22 mediante
el build command `npm test` y gestiona el despliegue automático en Cloudflare.

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
   antidump.nolagnetwork.net/servers/13/files/*
   ```

   En **Settings → Domains & Routes**, confirma esa Route y la zona
   `nolagnetwork.net`. El patrón cubre HTTP y HTTPS.

4. En **Settings → Variables and Secrets**, añade **`NOLAG_API_KEY` como Secret
   de runtime**. Obtén el valor de **GHOSTNETWORKS → Config FiveM → Config
   Cloudflare** en NOLAG. El Secret autentica los reportes y permite solicitar
   el ban externo de descargas. El filtro rechaza el perfil detectado incluso
   si el reporte no está configurado, pero no podrá aplicar ese ban adicional.

5. Cada push a la rama conectada genera un nuevo despliegue. Las variables de
   host/servidor/URL están versionadas en `wrangler.jsonc`; el Secret se mantiene
   en Cloudflare, fuera del repositorio.

Este proyecto ejecuta un Worker HTTP. En el menú **Workers & Pages** selecciona
el flujo de Worker para que Cloudflare utilice Wrangler y la Route.

## Configuración actual: GHOSTNETWORKS

| Variable | Valor |
|---|---|
| `NOLAG_HOST` | `antidump.nolagnetwork.net` |
| `NOLAG_SERVER_ID` | `13` |
| `NOLAG_PANEL_URL` | `https://panel.nolagnetwork.net` |
| `NOLAG_API_KEY` | Secret añadido en Cloudflare |

Para otro registro, modifica la Route y `NOLAG_SERVER_ID` en `wrangler.jsonc`
y utiliza la API key de ese registro. Cada despliegue de este paquete filtra
el servidor configurado.

El hostname debe seguir apuntando al Tunnel mediante su DNS proxied. La Route
añade el Worker delante del origen existente; utiliza ese mismo hostname y
su zona, sin asignarlo como Custom Domain del Worker. El Tunnel debe estar
activo y NOLAG debe seguir accesible por esa ruta.

Publica `antidump.nolagnetwork.net` en el Tunnel hacia `http://127.0.0.1:8080`,
con HTTP Host Header `antidump.nolagnetwork.net`. Verifica que `/health` devuelva
el JSON de NOLAG con estado 200; un 522 requiere corregir DNS/Tunnel al origen.

El panel y los reportes se publican en `https://panel.nolagnetwork.net/`.
Publica también ese hostname en el Tunnel hacia `http://127.0.0.1:8080`, con
HTTP Host Header `panel.nolagnetwork.net`. La Route del Worker solo intercepta
las descargas `/servers/13/files/*`, no el panel ni sus APIs.

La variable opcional `NOLAG_HOST_ALIASES` permite filtrar otros hostnames
explícitos, separados por comas, si también tienen sus Routes configuradas.

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
   X-Nolag-Edge-Version: 1.3.0
   ```

3. Con el Secret configurado, NOLAG recibirá el evento
   `http_client_profile_blocked`. Los reportes tienen cooldown por IP/servidor
   de un minuto por instancia del Worker. La versión 1.3 envía el token nativo
   únicamente como header privado del reporte HTTPS, para que el panel valide
   la sesión en FXServer; no lo incluye en el cuerpo, logs ni webhooks.
4. Si el servidor está en modo Bloqueo y FXServer verifica esa sesión, el panel
   aplica un **ban de descargas por IP y servidor de 24 horas** por defecto.
   La duración se configura con `ANTIDUMP_EDGE_BAN_MINUTES` en el panel.
   Tokens ausentes/falsos/de otro servidor, autenticación no disponible,
   fallback de IP y modo Monitoreo no producen ese ban automático.

El resultado del reporte indica `scope: downloads` y `game_action: unavailable`.
Ese ban no ejecuta DropPlayer ni bloquea una reconexión con caché del juego:
para esas acciones hace falta una interfaz de administración de FXServer.

Un 403 por falta de token del proxy, sin ese header, no demuestra que este
filtro del edge se haya ejecutado. El archivo de configuración no confirma
por sí solo que la Route esté activa en tu cuenta.

## Alcance

El filtro utiliza la metadata original `request.cf.clientAcceptEncoding`
porque Cloudflare normaliza los headers enviados al Tunnel. Detecta el perfil
por defecto de `requests.Session` de la versión compartida, aunque copie
`CitizenFX/1` y un token válido.

Es una heurística evadible: una herramienta que cambie sus headers puede
superarla antes de una detección. No impide lectura de memoria/caché, no revoca
el token del juego y no cubre descargas que eviten NOLAG. No ofrece una garantía de 100%
antidump ni identifica el lenguaje del programa.

## Referencias

- [Workers Builds desde Git](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Tunnel y DNS](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
- [Headers originales y normalizados](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
