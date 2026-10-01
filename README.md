# Jaque Royale

MVP de ajedrez multijugador en español. Backend Node.js, WebSockets con `ws`, reglas con `chess.js`, SQLite y frontend HTML/CSS/JavaScript sin compilación.

## Ejecutar

Requiere Node.js 24 o superior.

```powershell
npm install
npm start
```

También puedes usar `pnpm install` y `pnpm start`. Abre http://localhost:3000, introduce un nombre y crea una partida. En otro navegador o perfil introduce otro nombre y únete con el código. Dos pestañas del mismo perfil comparten la identidad; para probar dos jugadores utiliza una ventana privada.

Para dos dispositivos en la misma red, abre `http://IP_DEL_SERVIDOR:3000` en ambos y permite el puerto 3000 en el firewall. Un enlace con localhost solo funciona en la computadora que ejecuta el servidor. Para jugar por internet hay que desplegar el servicio con HTTPS y soporte de WebSockets.

## Funcionalidad

- Salas privadas por código: creador con blancas, invitado con negras.
- Movimientos y turnos validados por el servidor, enroque, captura al paso, promoción y fin de partida según las reglas.
- Rendición y oferta/aceptación de tablas.
- Reconexión automática y recuperación de salas tras reiniciar el servicio.
- Identidad de invitado mediante un token guardado en el navegador; nombres únicos.
- SQLite en `data/chess.sqlite`: usuarios, partidas completas en PGN y cambios de Elo.
- Elo inicial 1200 y factor K=32; puntuación de 1 por victoria, 0.5 por tablas y 0 por derrota.
- Clasificación e historial. Resultados y puntuaciones se actualizan una sola vez mediante una transacción.

## Verificación

```powershell
npm test
```

Pruebas de dos clientes WebSocket, rechazo de turnos/movimientos inválidos, mate, Elo, historial, reconexión de identidad y reglas especiales.

## Límites del MVP

Sin contraseñas, recuperación de cuenta, reloj, emparejamiento público ni espectadores. El token funciona como credencial: perder los datos del navegador pierde el acceso al jugador. Una desconexión no termina la partida; se permite regresar. Las salas y partidas permanecen en SQLite. El servidor está diseñado para una sola instancia; escalar requiere coordinación compartida entre procesos.

Para producción: HTTPS, cuentas recuperables, límites de creación de usuarios por IP, copias de seguridad de SQLite y monitoreo. El puerto se configura con `PORT` (3000 por defecto). `GET /api/health` sirve para comprobar el proceso.

## Estructura

- `server.js`: HTTP, WebSockets, persistencia y puntuación.
- `public/`: tablero e interfaz.
- `test/`: verificaciones automatizadas.
- `data/`: base de datos local, excluida de Git.

Documentación de dependencias: [chess.js](https://www.npmjs.com/package/chess.js) y [ws](https://github.com/websockets/ws).
