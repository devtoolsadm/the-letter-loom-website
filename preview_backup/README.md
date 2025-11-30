# Letter Loom

Proyecto web estático para el juego Letter Loom.

## Estructura
- `index.html`, `score-modal.html`: Archivos HTML principales.
- `assets/`: Recursos gráficos (SVG).
- `src/`: Código fuente.
  - `gameController.js`: Lógica principal del juego.
  - `i18n/`: Textos e internacionalización.
  - `ui/`: Archivos de interfaz (JS y CSS).
  - `version.js`: Archivo de versión (sobrescrito por CI/CD en despliegue).

## Notas sobre versión
El archivo `src/version.js` es sobrescrito automáticamente por CI/CD durante el despliegue. En el código fuente, no contiene un número de versión real para evitar confusión.

## Despliegue
El proyecto está preparado para ser publicado en GitHub Pages mediante integración continua.
