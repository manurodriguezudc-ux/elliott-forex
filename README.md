# Vigilancia Elliott H1/H4: puente de velas gratuitas para ChatGPT

Sin EA, sin terminal MT4 encendido y sin claves de cotizaciones.

El servicio obtiene velas Bid H1 y H4 de Dukascopy mediante la librería abierta **dukascopy-node**. En cada ejecución produce una web con las velas cerradas y sus horas UTC, cobertura por par y candidatos heurísticos a onda 1 o comienzo de onda 2. **No abre operaciones.**

## Instalación (una sola vez)

1. Crea un repositorio **público** nuevo en https://github.com/new llamado `elliott-forex` (nombre sugerido). Manténlo vacío al crearlo.
2. Descomprime este ZIP en tu equipo. Sube TODOS los archivos y carpetas al repositorio, respetando la carpeta oculta `.github/workflows/update.yml`. GitHub permite subir archivos desde **Add file → Upload files** (en Windows `.github` existe después de descomprimir). Si el navegador omite la carpeta oculta, créala usando **Add file → Create new file** con nombre `.github/workflows/update.yml` y pega su contenido.
3. En el repositorio, entra en **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Ve a **Actions → Actualizar velas Forex H1 H4 → Run workflow** y espera su finalización. La primera descarga puede tardar. Si la ejecución falla, abre el registro para ver el problema y no des por probadas las fuentes.
5. En **Settings → Pages** GitHub indicará la URL pública; normalmente será `https://TU_USUARIO.github.io/elliott-forex/`. Ábrela: debe decir cuántas de las 30 series se han verificado y enlazar a sus velas.
6. Pega AQUÍ esa URL para que podamos probar si ChatGPT puede leerla y, **solo después**, editar tu automatización existente para que analice esa página antes de las revisiones de las 09:00, 14:00 y 21:00.

## Cuándo se actualiza

De lunes a viernes aproximadamente a las **08:35, 13:35 y 20:35 en Europe/Madrid**. Las ejecuciones cron de GitHub Actions pueden retrasarse, especialmente con carga; verifica siempre la marca horaria antes de usar un dato. Si el proveedor no entrega velas recientes, el informe marca la serie **NO VERIFICADA**.

## Cobertura

EUR/USD, CAD/JPY, GBP/CHF, AUD/NZD, GBP/JPY, GBP/USD, USD/JPY, AUD/USD, NZD/USD, USD/CAD, USD/CHF, EUR/JPY, EUR/GBP, AUD/JPY, EUR/AUD. Para cada par, H1 y H4.

## Advertencias técnicas

- La API de tiempo real de `dukascopy-node` está marcada por sus autores como **experimental**; el script intenta descarga histórica como alternativa. No podemos garantizar acceso desde todos los servidores de GitHub sin probarlo.
- La página es pública. Solo contiene series OHLC y resúmenes, no contraseñas ni posiciones. Nunca subas contraseñas, claves, credenciales MT4 o datos privados.
- No se publican velas en formación. En fin de semana los datos se marcan no recientes.
- Los candidatos generados son una **criba mecánica** (pivotes de tres velas, ruptura por cierre, tramo mínimo). La interpretación X-1-2 definitiva debe hacerla el análisis posterior. No se garantiza que una onda 1 tenga cinco subondas ni que una onda 2 termine.
- El agente ChatGPT debe comprobar la fuente y los datos; si su navegador bloquea la URL o están atrasados, debe avisar de ello y no inventar una oportunidad.
- **No está probado contra datos en vivo en este entorno**. Los scripts han sido revisados sintácticamente y se incluyen pruebas unitarias sintéticas de validación, no una garantía de funcionamiento de Dukascopy o de acceso desde ChatGPT.
