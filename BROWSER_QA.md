# Validación visual del MVP

## Entorno aislado

```powershell
node scripts/preview-qa.mjs
```

Solo datos sintéticos y SQLite en memoria,127.0.0.1:3001. Nunca usa la base del
jugador. Cuenta qa@example.com / rival@example.com; contraseña de ambas:
`Jaque QA 2026 seguro!`. Esta contraseña pública pertenece exclusivamente a QA.
Detener el script elimina ese estado. Para dos identidades en el mismo navegador,
usar127.0.0.1:3001 y localhost:3001; las cookies quedan separadas por hostname.
Este permiso de origen dinámico se limita al servidor de desarrollo.

## Recorridos comprobados con el navegador integrado

- Login → inicio con Elo por ritmo y estadísticas → selector de bot fácil con
  blancas → e4 → respuesta e5 → rendición → revisión automática Stockfish19 →
  navegación al primer movimiento, evaluación y precisiones. Consola sin avisos.
- Catálogo de30 rompecabezas → mate de pasillo → pista → Re8# → resultado con
  ayuda y explicación. Se corrigió el contador para actualizar al terminar.
- Catálogo de12 ejercicios → promoción a8 → selector de pieza → dama → progreso
  1/12 sin ayuda. No hubo errores ni advertencias de consola.
- Ejercicio de mate3 → Kf6 y respuesta Kg8 → recarga del enlace directo → misma
  secuencia recuperada → deshacer restaura la posición y marca ayuda.
- Viewport390×844: tablero, promoción/controles y exploración; sin desbordamiento
  horizontal. Exploración permite mover ambos lados y deshacer; no suma progreso.
  Esta prueba de tamaño no equivale a una prueba física en teléfono táctil.
- Dos cuentas independientes: crear sala blitz3+2, unir con código, e4/e5/Nf3/Nc6;
  Nf3 introducido con Enter y flechas. Ambos clientes muestran la misma secuencia.
- Oferta/aceptación de tablas → resultado guardado → oferta/aceptación de revancha
  → nueva sala con colores cambiados → recargar recupera la partida activa.
- Al agotar el reloj real de la revancha, ambos reciben el resultado por tiempo.
  Ninguna consola de estos dos clientes mostró errores ni advertencias.

- Arrastre real del puntero: dama de g6 a g7 en el ejercicio de mate, Qg7#;
  solución registrada sin ayuda.

## Correcciones encontradas durante QA

- Un final requería más jugadas para coronar: el generador ahora exige promoción
  efectiva. Una composición estaba duplicada: el catálogo tiene30 FEN distintos.
- Contador de entrenamiento actualizado y enlaces directos esperan la sesión.
- Navegación del tablero por flechas sin saltar de una fila a otra; un punto de
  entrada al tablero con Tab, manteniendo el foco al redibujar.
- Limpieza del tablero cuando cambia la cuenta; protección visual de análisis y
  entrenamiento mientras haya una partida humana, además de protección servidor.
- Mates2 aceptan alternativas equivalentes, comprobadas contra todas las defensas
  legales. La solución elegida por el generador no es el único camino aceptado.

## Validación todavía pendiente

La revisión final local comprobó inicio, enlace directo de práctica y recarga,
cierre de sesión y ocultación de una revisión inválida; consolas sin avisos.
Queda verificar móvil físico y recuperación de cuenta
desde el correo real. Los ensayos de Linux de Docker/Caddy, cierre/reinicio,
restauración y carga ya están automatizados y aprobados en CI (véase abajo).
Queda repetir las comprobaciones operativas en el servidor destino.

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
