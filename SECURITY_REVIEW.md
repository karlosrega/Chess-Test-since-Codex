# Revisión de seguridad de imágenes

Estado: evaluación en curso; no autoriza apertura pública.

La aplicación migró a Distroless Debian13 conservando Node24.19 y Stockfish19.
El escaneo inicial reportó272 hallazgos (71 altos/críticos); la imagen mínima
reportó31 medios/bajos, sin altos/críticos. Se conservan todos en los artefactos CI.
Evidencia: https://github.com/karlosrega/Chess-Test-since-Codex/actions/runs/37029406732

El proxy se reconstruye con Caddy2.11.6 y Go1.27.1. El escaneo ya no encontró
altos/críticos, pero govulncheck detectó código OpenPGP antiguo enlazado:
GO-2026-5932, paquete golang.org/x/crypto/openpgp, sin versión corregida.
Se está identificando su dependencia para sustituirlo; no ignorar el aviso.
Referencia oficial: https://pkg.go.dev/vuln/GO-2026-5932

## Hallazgos del sistema de la aplicación

Trivy0.75.0 no indica versión corregida para los siguientes hallazgos.
Esto no demuestra que sean inocuos o explotables. Requieren revisión antes
 de producción y seguimiento de actualizaciones de la imagen base.

| Aviso | Paquete | Severidad | Versión |
|---|---|---|---|
| CVE-2026-102010 | gcc-14-base | MEDIUM | 14.2.0-19 |
| CVE-2026-95619 | gcc-14-base | MEDIUM | 14.2.0-19 |
| CVE-2026-18374 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-19499 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-19542 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-5435 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-6238 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-6368 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-6791 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-77117 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-80489 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-8674 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-86805 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-89092 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2026-95818 | libc6 | MEDIUM | 2.41-12+deb13u4 |
| CVE-2010-4756 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2018-20796 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2019-1010022 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2019-1010023 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2019-1010024 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2019-1010025 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2019-9192 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2026-97399 | libc6 | LOW | 2.41-12+deb13u4 |
| CVE-2026-102010 | libgcc-s1 | MEDIUM | 14.2.0-19 |
| CVE-2026-95619 | libgcc-s1 | MEDIUM | 14.2.0-19 |
| CVE-2026-102010 | libgomp1 | MEDIUM | 14.2.0-19 |
| CVE-2026-95619 | libgomp1 | MEDIUM | 14.2.0-19 |
| CVE-2026-102010 | libstdc++6 | MEDIUM | 14.2.0-19 |
| CVE-2026-95619 | libstdc++6 | MEDIUM | 14.2.0-19 |
| CVE-2026-27171 | zlib1g | MEDIUM | 1:1.3.dfsg+really1.3.1-1+b1 |
| CVE-2026-85091 | zlib1g | MEDIUM | 1:1.3.dfsg+really1.3.1-1+b1 |

## Controles aplicados

UID1000, sistema de archivos en solo lectura, sin shell/npm, sin capacidades
Linux, no-new-privileges, recursos limitados y volúmenes de datos separados.
Estos controles reducen exposición; no corrigen por sí solos las vulnerabilidades.
CI falla ante hallazgos altos/críticos y ante avisos detectados por govulncheck.
No se añadió ninguna lista de excepciones al escáner.

