# Android

La app web ya incluye manifest, service worker e iconos instalables. El APK se
genera como Trusted Web Activity (TWA) una vez que exista una URL HTTPS estable.

## Datos previstos

- Application ID: `com.recetuliscosmicas.app`
- Nombre: `Recetulis Cósmicas`
- Manifest web: `https://DOMINIO/manifest.webmanifest`
- Alcance: `https://DOMINIO/`

## Generación

1. Instalar Java 17 y Android Studio/SDK.
2. Instalar Bubblewrap: `npm install --global @bubblewrap/cli`.
3. Ejecutar `bubblewrap init --manifest=https://DOMINIO/manifest.webmanifest`.
4. Guardar el keystore fuera del repositorio y ejecutar `bubblewrap build`.
5. Publicar la huella SHA-256 de la firma en
   `public/.well-known/assetlinks.json` y volver a desplegar.

El APK/AAB final no debe compilarse antes de definir el dominio y conservar el
keystore definitivo: Android usa esa firma para validar futuras actualizaciones.
