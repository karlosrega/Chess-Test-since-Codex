# MVP Jaque Royale — estado de implementación

## Alcance implementado

- Inicio adaptable con jugar, rompecabezas y práctica; estadísticas, Elo por ritmo,
  gráfica, historial paginado, precisión propia, progreso y partida activa.
- Cuentas, recuperación, sesiones revocables, conversión de invitados y SMTP con TLS.
- Amigos, emparejamiento por Elo, tres ritmos, relojes persistentes, reglas,
  rendición, tablas, reconexión y revancha. Bots Stockfish19 de tres niveles.
- Análisis automático persistente con recuperación, revisión y permisos. Análisis
  y entrenamiento bloqueados mientras exista una partida humana activa.
- 30 tácticas originales y12 ejercicios con progreso, pistas, explicaciones,
  alternativas de mate, promoción, exploración y deshacer.
- Tablero reutilizable: clic, arrastre, teclado, legales, jaque y capturas.
- Migraciones SQLite atómicas, copias consistentes con WAL, checksum, restauración
  y bloqueo de una segunda instancia. Límites HTTP/WS, CSP, CSRF y secretos externos.
- Imagen Docker y proxy Caddy configurados para servidor Linux con HTTPS.

## Evidencia local — 2026-10-01

49 pruebas automatizadas pasan sin fallos ni omisiones en Windows/Node24.19.
Incluyen motor real,42 composiciones, privacidad, persistencia, SMTP local,
arranque, integridad/referencias, copias y restauración. Prueba concurrente:
32 sesiones WebSocket y16 partidas; últimas latencias locales p95=309.4ms,
event loop p99=272.4ms. Estas cifras no certifican capacidad del servidor Linux.
Auditoría de dependencias de producción: sin vulnerabilidades conocidas.
37 módulos comprobados con node --check: sin errores de sintaxis. La validación
SMTP rechaza separadores de múltiples direcciones; las6 pruebas de producción
pasan nuevamente después de ese ajuste.

BROWSER_QA.md registra los recorridos visuales con dos cuentas, relojes, tablas,
revancha, bot/análisis, entrenamiento, promoción, teclado y arrastre. Viewport
390×844 sin desbordamiento horizontal; no sustituye una prueba táctil física.

## Decisiones y límites

Elo inicial1200/K32 por ritmo, solo competitivo. Amigos y bots no cambian Elo.
Precisión propia100×exp(-.004×pérdida media), cap1000cp; etiquetas50/100/200cp
más pérdida de mate. No es la fórmula de Chess.com. Un servidor con SQLite local;
no escalar réplicas sobre el mismo volumen. Adjudicación por tiempo considera
material de mate, sin resolver todas las fortalezas arbitrarias.

## Validación pendiente antes de apertura pública

1. Build/pruebas Docker en Linux y validación Caddy aprobados; falta comprobar
   permisos y persistencia del volumen en el entorno destino.
2. Comprobar HTTPS, cierre/reinicio, copia/restauración y carga en el entorno destino.
3. Revisar los hallazgos medios/bajos del escaneo y el aviso del proxy en SECURITY_REVIEW.md.
4. Elegir dominio y SMTP: el usuario todavía no dispone de ambos. Configurar secretos
   y probar recuperación desde un correo real, certificado y renovación.
5. Revisar en un teléfono real y configurar copias externas y monitoreo operativo.

El equipo actual no dispone de Docker ni WSL instalado. La rama
codex/jaque-royale-mvp y el PR en borrador #1 se publicaron con autorización.
La imagen Linux se construyó en Ubuntu24.04;49 pruebas aprobadas, Caddy válido,
usuario no root y dependencias sin vulnerabilidades conocidas. Evidencia:
https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/36954116089.
Se detectaron y corrigieron dos advertencias de Caddy (cabecera redundante y
formato). No se ha desplegado ni fusionado el producto. No declarar el objetivo
completo hasta cerrar las validaciones necesarias. OPERATIONS.md contiene
los procedimientos y criterios de puesta en producción.

## Validación ampliada — 2026-10-02

GitHub Actions en Ubuntu24.04, ejecución37031738943:
https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/37031738943

- Las49 pruebas pasan también dentro de la imagen final con sistema de archivos
  de solo lectura, usuario1000, memoria1GiB,2CPU y sin capacidades adicionales.
- Volúmenes reales Docker: sesiones/partida/reloj sobreviven a SIGTERM y reinicio;
  copia consistente de SQLite en uso, restauración tras una mutación y recuperación
  tras SIGKILL. Integridad y referencias verificadas en el volumen restaurado.
-128 sesiones autenticadas sintéticas,64 partidas y384 acciones: p95=93.1ms,
  event loop p99=91.2ms, RSS=138.5MiB. No mide login ni certifica capacidad del
  servidor destino; repetir allí antes de abrir al público.
- Chromium automatizado, escritorio1280×800 y táctil simulado390×844: registro,
  cierre/inicio de sesión, dos jugadores, arrastre/toques, recarga y recuperación,
  tablas, rompecabezas, práctica persistente, promoción y progreso. Sin errores
  ni advertencias de consola ni desbordamiento horizontal en los recorridos.
- Corregido cierre de sesión móvil: el botón ahora permanece en la cabecera.

Los controles funcionales pasaron en esa ejecución. La evaluación de seguridad
se registra separadamente en SECURITY_REVIEW.md; no se ha aprobado la apertura
pública. Estas pruebas usan cuentas, correo simulado y volúmenes desechables.

Validación posterior completa, incluida seguridad, aprobada en ejecución37032456413:
https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/37032456413
Carga de esta repetición: p95=184.1ms, event loop p99=181.0ms, RSS=136.9MiB;
las métricas varían entre ejecuciones y todas quedan por debajo del umbral de1s.
Sin hallazgos altos/críticos; quedan23 medios y8 bajos y1 aviso UNKNOWN del
módulo del proxy. El análisis del binario confirma0 paquetes vulnerables
importados. Revisar SECURITY_REVIEW.md para alcance y advertencias del escáner.

Regresión adicional: cerrar sesión mientras una petición de inicio de ejercicio
está retrasada. Se invalidan las continuaciones del entrenamiento y se esperan
las peticiones en curso antes de revocar la sesión (timeout HTTP15s). Se evita
que respuestas antiguas repueblen la interfaz; los mensajes del socket cerrado
se desconectan. El navegador local pasa escritorio y móvil con esta regresión.
