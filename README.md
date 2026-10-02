# Jaque Royale

MVP de ajedrez en español: jugar, entrenar y revisar tus partidas desde una
interfaz adaptable. Backend Node24, WebSockets, SQLite, Stockfish19 y frontend
HTML/CSS/JavaScript modular.

## Ejecutar en desarrollo

Requiere Node24.19 y pnpm11.19. El motor debe instalarse antes de ejecutar las
pruebas o jugar contra la computadora. Su descarga oficial se verifica por SHA256.

```powershell
pnpm install --frozen-lockfile
node scripts/install-engine.mjs
pnpm start
```

Abre [localhost:3000](http://localhost:3000). Crea una cuenta con correo y
contraseña (mínimo12 caracteres) o inicia sesión. El modo de desarrollo escucha
solo en127.0.0.1. Para una prueba en LAN, configurar HOST explícitamente y mantener
el entorno protegido; producción requiere HTTPS.

Dos pestañas del mismo perfil comparten la cuenta. Para probar dos jugadores usa
perfiles separados o el servidor aislado de QA descrito en BROWSER_QA.md.

## Qué incluye

- Inicio con tres caminos: jugar, rompecabezas y práctica guiada; Elo por ritmo,
  resultados V/T/D, porcentaje de victorias, gráfica, historial, precisión propia,
  progreso de entrenamiento y acceso a la partida activa.
- Cuentas recuperables, sesiones HttpOnly, CSRF, revocación al cerrar sesión o
  cambiar contraseña y conversión de invitados anteriores conservando identidad.
- Amigos por código/enlace con elección de color; emparejamiento público por Elo
  y ritmo; búsqueda cancelable. Solo una partida o búsqueda activa por usuario.
- Bullet1+0, blitz3+2 y rápidas10+0. Elo inicial1200, K32, independiente por ritmo,
  actualizado únicamente en emparejamiento competitivo. Amigos y bots no cambian Elo.
- Relojes persistentes y autoritativos, turnos, promoción, enroque, captura al paso,
  finalización, rendición, tablas, reconexión y revancha con colores intercambiados.
- Bots fácil/medio/difícil con Stockfish19, elección de color y sin reloj.
- Análisis automático de nuevas partidas terminadas: cola persistente, estados,
  recuperación/reintento, reproducción, evaluación y oportunidades de mejora.
- 30 posiciones tácticas originales (10 por dificultad) y12 ejercicios guiados
  (6 mates y6 finales): respuestas del rival, alternativas válidas de mate, pistas,
  explicación, progreso guardado, exploración y deshacer en práctica.
- Tablero reutilizable con clic, arrastre, teclado, puntos de movimientos legales,
  última jugada, jaque y capturas. Interfaz adaptable a móvil.

Los rompecabezas usan composiciones didácticas propias y variantes de orientación
para practicar con ambos colores. Las secuencias se validan en el servidor; pedir
pistas/deshacer/explorar marca ayuda. Mostrar la solución no concede un ejercicio
resuelto. El contenido y sus soluciones están en lib/training-catalog.json; el
script build-training.mjs verifica composiciones y todas las defensas legales de
los mates forzados antes de regenerarlo. No reutilizar IDs de contenido para otras
posiciones cuando ya haya progreso de jugadores.

## Recuperación de cuenta

Sin SMTP, desarrollo usa un buzón local: GET /api/dev/mailbox desde localhost.
Está deshabilitado en producción. Los enlaces vencen en30min y se usan una vez.
No guarda ni publica contraseñas. SMTP real requiere remitente, credenciales como
secretos y TLS validado. Ver production.env.example y OPERATIONS.md.

## Pruebas

```powershell
pnpm test
pnpm audit --prod
node scripts/preview-qa.mjs
```

49 pruebas automatizadas pasan actualmente en Windows, sin fallos ni omisiones:
cuentas, privacidad, migraciones, WebSockets, reglas, relojes, Elo, bots/motor real,
análisis,42 composiciones, progreso, SMTP local, preparación de producción,
bloqueo de instancias y copias/restauración. También se prueban32 sesiones con16
partidas simultáneas. BROWSER_QA.md registra recorridos visuales y límites de esa
validación. La validación en GitHub Actions construyó la imagen Linux y aprobó las49 pruebas
con Stockfish real, validación Caddy, usuario1000 y auditoría de dependencias.
Evidencia: https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/36954116089.

## Datos y operación

SQLite se guarda en data/chess.sqlite (o DATABASE_PATH), excluido de Git.
Las migraciones son atómicas y generan una copia previa si cambia el esquema de
una base existente. No eliminar data para actualizar. Las copias operativas usan
la API SQLite para incluir el WAL y se verifican antes de restaurar.

```powershell
node scripts/backup.mjs data/chess.sqlite backups/fecha.sqlite
# Detener el servidor antes de restaurar:
node scripts/restore.mjs backups/fecha.sqlite data/chess.sqlite --offline
```

Consultar [OPERATIONS.md](OPERATIONS.md) para Docker, HTTPS, secretos, copias,
restauración y monitoreo; [ENGINE.md](ENGINE.md) para licencia GPL y código fuente
exacto de Stockfish. El MVP opera en una sola instancia con volumen local.

## Estado para producción

El MVP funciona y tiene validación local. **La cadena HTTPS real y el SMTP real siguen pendientes**: la imagen y pruebas
Docker/Linux ya se validaron en GitHub Actions, pero aún no se ha elegido
dominio/proveedor ni comprobado el entorno destino. No considerar la apertura
pública aprobada hasta completar los criterios de OPERATIONS.md.

La precisión es un índice aproximado propio:100×exp(-0.004×pérdida media), con
pérdida máxima1000cp por jugada. No equivale a la fórmula de otras plataformas.
No se ofrecen análisis ni entrenamiento durante partidas humanas activas. La
adjudicación de tiempo comprueba material de mate; no resuelve todas las
fortalezas arbitrarias. Torneos, chat, espectadores, pagos y anti-trampas avanzado
quedan fuera de este MVP.

## Estructura

- server.js: HTTP, sesiones WebSocket e integración de servicios.
- lib/: cuentas, migraciones, partidas, estadísticas, motor, análisis, entrenamiento,
  SMTP y copias.
- public/: interfaz, tablero, revisión y entrenamiento.
- test/: pruebas automatizadas con SQLite y motor reales.
- scripts/: instalador del motor, generación del catálogo, QA y copias.
- Dockerfile / compose.yaml / deploy/: configuración Linux/HTTPS.

Referencias técnicas: [Stockfish](https://stockfishchess.org/download/),
[chess.js](https://github.com/jhlywa/chess.js), [ws](https://github.com/websockets/ws),
[Nodemailer SMTP](https://nodemailer.com/smtp),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
