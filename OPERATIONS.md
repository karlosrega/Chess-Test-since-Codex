# Operación de Jaque Royale

## Estado de validación

El backend se ha probado en Windows con Node24.19 y Stockfish19 real. La imagen
Linux y el proxy Caddy tienen configuración reproducible y un workflow de
validación, pero **todavía no se han ejecutado**: este equipo no tiene Docker ni
WSL. Tampoco hay dominio/proveedor SMTP elegidos. No abrir el servicio al público
hasta cerrar estas comprobaciones. No se ha desplegado ni publicado esta entrega.

## Arquitectura y capacidad

Una instancia Node, SQLite en volumen local persistente, Caddy delante con HTTPS.
El puerto3000 solo está dentro de la red Docker. Bots y análisis usan procesos
Stockfish independientes; el análisis tiene un trabajador y cola persistente.
No escalar horizontalmente este MVP: el emparejamiento vive en memoria y la base
tiene un bloqueo exclusivo de aplicación. No compartir el volumen SQLite por NFS.
La cola de emparejamiento se pierde al reiniciar; las partidas y relojes persisten.
Los relojes continúan durante la desconexión y el mantenimiento.

Los límites actuales son256 WebSockets,8 por IP,512 conexiones HTTP,20 mensajes/s
por socket,300 solicitudes API/min/IP y30 intentos de autenticación/15min/ruta/IP.
Estos límites son protecciones, no una capacidad de carga certificada. Hace falta
medir carga en el servidor Linux elegido antes de fijar un número de usuarios.

## Preparación del servidor

Requiere Docker Engine y Compose en Linux, disco persistente y salida a Internet
para instalar las imágenes y Stockfish. El build descarga la distribución oficial
fijada, verifica SHA256 y ejecuta todas las pruebas. La construcción usa Node24.19 fijado por digest y la imagen final Distroless
Debian13, sin npm ni shell, con UID1000. El proxy se compila desde Caddy2.11.6
con Go1.27.1; las bases también están fijadas por digest. Actualizar
deliberadamente y repetir pruebas/auditoría. La imagen final no permite comandos
de shell: usar docker compose exec app node ... para tareas operativas.

1. Elegir dominio y dirigir DNS al servidor. Abrir80/TCP,443/TCP y opcional443/UDP.
2. Elegir proveedor SMTP, verificar remitente y configurar SPF/DKIM/DMARC según
   sus instrucciones. Usar STARTTLS587 o TLS465; no desactivar validación TLS.
3. Copiar `production.env.example` a `.env` y completar dominio/proveedor/usuario.
4. Crear `deploy/secrets/smtp_password` con la contraseña del proveedor. Mantener
   permisos restrictivos y fuera de Git; no introducirla en comandos compartidos.
5. Comprobar que la subred172.30.42.0/24 no colisiona con la red del servidor.
   Si se cambia, actualizar red, direcciones y TRUST_PROXY_IP a la vez.

```sh
docker compose config --quiet
docker compose build
docker compose run --rm --no-deps --entrypoint node app --test
docker compose up -d
docker compose ps
curl --fail https://TU_DOMINIO/api/ready
```

El arranque de producción exige PUBLIC_URL HTTPS, credenciales SMTP, conexión
SMTP comprobada, integridad SQLite y Stockfish19 operativo. Un fallo impide
escuchar conexiones. Caddy espera a que la aplicación esté saludable. Configura
un certificado HTTPS válido y comprueba cookies Secure, login, recuperación real,
WebSockets, dos jugadores, relojes y análisis desde otro dispositivo.

`TRUST_PROXY_IP` solo confía en la dirección fija de Caddy. No exponer el backend
directamente ni aceptar X-Forwarded-For de cualquier dirección. Si se incorpora
otro proxy/CDN, revisar y probar esa cadena antes de cambiar esta configuración.

## Copias y restauración

La copia usa la API de backup SQLite: incluye datos confirmados en WAL aunque
la aplicación esté en marcha. Se comprueban integridad, esquema y SHA256. No
copiar únicamente `chess.sqlite` mientras el servicio escribe. Las copias contienen
datos privados de usuarios; restringir acceso, cifrar la copia externa y definir
retención. El volumen local de backups no protege frente a perder el servidor.

```sh
# Usa un nombre nuevo cada vez. Programa diariamente con el scheduler del servidor.
docker compose exec app node scripts/backup.mjs /app/data/chess.sqlite /app/backups/FECHA.sqlite

# Copiar .sqlite y .sqlite.json fuera del servidor mediante almacenamiento seguro.
# Probar la restauración en un entorno separado antes de dar por válida una copia.

# Restaurar: detener aplicación y proxy. No borrar volúmenes.
docker compose stop caddy app
docker compose run --rm --no-deps --entrypoint node app scripts/restore.mjs /app/backups/FECHA.sqlite /app/data/chess.sqlite --offline
docker compose up -d
```

Restaurar exige el manifiesto SHA256, una copia íntegra y ninguna instancia
activa. Antes de sustituir la base guarda otra copia de la versión actual.
La recuperación devuelve los datos al momento del backup; sesiones/reset y
relojes vuelven a ese estado. Revisar sesiones, partidas y trabajos después.
No retirar `.lock` si el PID registrado sigue vivo. Un bloqueo corrupto exige
comprobar manualmente que la aplicación esté detenida.
El bloqueo incluye el hostname del contenedor: un contenedor nuevo no intenta
adivinar el estado de un PID de otra instancia. Si hubo SIGKILL y se recreó el
contenedor, comprobar que **todas** las instancias están detenidas antes de retirar
solo el archivo `chess.sqlite.lock`. Un reinicio dentro del mismo contenedor
recupera el bloqueo cuando confirma que el proceso anterior ya no existe.

## Monitoreo y mantenimiento

- `/api/health`: proceso responde. `/api/ready`:200 operativo,503 iniciando/cerrando.
- Vigilar externamente disponibilidad HTTPS, vencimiento del certificado,
  espacio libre, RAM/CPU, reinicios y copias recientes. Las alertas deben incluir
  fecha, error y componente sin contraseñas, cookies ni enlaces de recuperación.
- `docker compose logs --tail=200 app caddy`: errores de arranque, WebSockets y
  correo se registran sin contenido de mensajes ni credenciales SMTP. Los logs
  rotan10MB×3. No activar debug SMTP en producción.
- Revisar análisis fallidos/pendientes y bots con error. El usuario puede
  reintentar desde la interfaz. Un fallo de SMTP mantiene respuesta neutral de
  recuperación y registra aviso; el usuario debe volver a solicitar el enlace.
- SIGTERM/SIGINT cierran motores, conexiones y SQLite; el trabajo de análisis
  en curso vuelve a pendiente. Docker tiene30s de gracia e init para hijos.
- Antes de actualizar: backup, pruebas, auditoría de dependencias y de la imagen
  Linux. Hacer una prueba de restauración periódica. No usar `down -v` para actualizar.

## Criterios que faltan antes de apertura pública

- [x] Build Linux completo y configuración Caddy validados por Docker/CI.
  https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/36954116089 (49 pruebas, usuario1000 y auditoría de dependencias).
- [x] Auditoría de paquetes e imágenes completada en CI.
- [ ] Evaluar los23 hallazgos medios y8 bajos sin versión corregida;
  SECURITY_REVIEW.md conserva el detalle y el diagnóstico del aviso del proxy.
- [ ] Medición de carga y recuperación en el servidor elegido.
- [ ] Dominio real, certificado, proveedor SMTP y recuperación recibida en buzón real.
- [ ] Copia externa y restauración en el servidor destino. Las copias en caliente,
  volúmenes y restauración ya se ensayaron en contenedores desechables de CI.
- [ ] Recorridos finales escritorio/móvil con dos cuentas desde dispositivos distintos.

No hay torneos, chat, espectadores, pagos ni sistema avanzado contra trampas en
este MVP. La valoración de precisión es aproximada y propia. La adjudicación
de tiempo comprueba material de mate, sin resolver todas las fortalezas arbitrarias.
