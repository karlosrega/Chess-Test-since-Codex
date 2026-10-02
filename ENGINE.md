# Motor de ajedrez

Jaque Royale utiliza Stockfish19 mediante el protocolo UCI, como proceso externo.
La versión se fija para que las revisiones sean comparables. El motor valida su
identificación antes de aceptar búsquedas. No se transmite información a terceros.

## Instalación

```powershell
node scripts/install-engine.mjs
```

El instalador soporta Windows y Linux, x64/ARM64, usa la distribución oficial
sf_19 y verifica SHA256 antes de extraer. Requiere `tar` disponible (incluido en
Windows moderno y necesario en Linux). La descarga ocupa unos82MB. Los binarios
quedan en `engines/`, excluidos del repositorio. También se puede configurar
`STOCKFISH_PATH` con un ejecutable local de Stockfish19.

Se conserva la licencia incluida en el archivo descargado. Stockfish es GPLv3:
[código exacto de la versión](https://github.com/official-stockfish/Stockfish/tree/sf_19)
y [licencia](https://github.com/official-stockfish/Stockfish/blob/sf_19/Copying.txt).
Al distribuir el motor deben acompañarlo esa licencia y el enlace al código
correspondiente. No eliminar los avisos incluidos en la distribución.

Cada proceso utiliza1 hilo y32MB de tabla hash. Las búsquedas se serializan,
se limitan a64 pendientes y tienen timeout; el proceso se reinicia tras fallos.
Bots y análisis utilizarán procesos distintos para aislar su trabajo.
