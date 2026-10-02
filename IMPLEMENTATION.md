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

1. Ejecutar build/pruebas Docker en Linux, validar Caddy y permisos reales del volumen.
2. Comprobar HTTPS, cierre/reinicio, copia/restauración y carga en el entorno destino.
3. Escanear vulnerabilidades de la imagen y revisar los hallazgos aplicables.
4. Elegir dominio y SMTP: el usuario todavía no dispone de ambos. Configurar secretos
   y probar recuperación desde un correo real, certificado y renovación.
5. Revisar en un teléfono real y configurar copias externas y monitoreo operativo.

El equipo actual no dispone de Docker ni WSL instalado. El workflow de validación
Linux está preparado pero todavía no se ha publicado ni ejecutado. Los cambios
actuales permanecen locales; no se ha desplegado el producto. No declarar el
objetivo completo hasta cerrar las validaciones necesarias. OPERATIONS.md contiene
los procedimientos y criterios de puesta en producción.
