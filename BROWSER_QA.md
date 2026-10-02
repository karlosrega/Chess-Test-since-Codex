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
desde el correo real. En Linux: build de Docker, HTTPS/Caddy, cierre/reinicio,
restauración y carga. La suite automatizada no sustituye estas comprobaciones.
