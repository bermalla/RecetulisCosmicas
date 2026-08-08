# Recetulis Cósmicas para Android

Cliente móvil independiente de la web. Incluye la interfaz dentro del APK y se
comunica con la misma API protegida; la página puede cambiar o dejar de existir
sin que eso convierta a la app en una simple ventana del sitio.

## Configuración de Firebase

En el proyecto Firebase `recetulis-cosmicas` hay que registrar una aplicación
Android con estos datos:

- Package name: `com.recetuliscosmicas.app`
- SHA-1 de la clave de publicación:
  `FC:EF:03:38:4A:A0:5A:03:8D:E3:FE:35:EA:64:6E:E7:66:57:97:84`
- SHA-256 de la clave de publicación:
  `9D:22:3A:20:B7:67:73:05:BE:1C:85:FF:53:51:95:AB:64:84:6A:5C:6A:EA:66:B7:50:52:7B:92:31:ED:8F:E7`

El archivo descargado debe quedar en
`mobile/android/app/google-services.json`. Git lo ignora porque corresponde a
la configuración concreta de la instalación.

## Compilación

El script raíz prepara la interfaz, sincroniza Capacitor y genera el APK:

```powershell
.\scripts\build-android.ps1 -Configuration Release
```

La salida firmada queda en
`mobile/android/app/build/outputs/apk/release/app-release.apk`.

La clave de publicación y su contraseña viven únicamente en
`.android-secrets/`, fuera de Git. Hay que conservar una copia segura: Android
solo acepta una actualización sobre la app instalada si mantiene la misma
identidad de paquete y la misma firma.

## Actualizaciones sin tienda

La app consulta el manifiesto HTTPS `/mobile/latest.json`. Si hay una versión
nueva, verifica el SHA-256 del APK descargado y abre el instalador de Android.
Android vuelve a comprobar la firma y solicita confirmación al usuario; no es
posible instalar silenciosamente una actualización en un teléfono personal.

## Navegación y modo sin conexión

El botón físico Atrás cierra primero la receta, el formulario o los ajustes. En
la pantalla inicial minimiza la app. Las recetas ya sincronizadas se guardan en
el almacenamiento privado de la aplicación, y también se puede trabajar con
una colección local separada e importar o exportar un respaldo JSON.
