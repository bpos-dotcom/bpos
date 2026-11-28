# B-POS Dueño (Android)

App del dueño con B-POS completo adentro. Abre www.bpos.com.mx/dueno y el botón
"B-POS completo" entra al resto de B-POS en la misma app.

- **Siempre la versión publicada:** la app carga B-POS de www.bpos.com.mx; los
  arreglos llegan solos, sin reinstalar.
- **Los datos en el teléfono, no en el navegador:** lo que Chrome guardaba en su
  memoria (unos 5 MB, se llenaba) se guarda en archivos de la app
  (`DiscoBpos.java` + `assets/disco.js`), igual que la caja local del Agent en
  Windows. Por eso B-POS guarda 30 días de ventas y de inventario aquí.
- La primera vez se inicia sesión normal y baja todo de la nube (la app no
  comparte datos con Chrome).

## Compilar

Proyecto Gradle normal (Java, sin Kotlin). Requisitos: JDK 17 y Android SDK 35.

- APK de pruebas: `gradle assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
  (va firmado con la llave de pruebas; se instala directo, sin Play Store).
- No trae `gradlew`: usa el Gradle de tu herramienta (8.9 o más nuevo).

## Todavía no

- **Notificaciones del dueño dentro de la app:** Android no deja que una app
  con página web reciba las notificaciones de Chrome; hacen falta las de Google
  (Firebase). Mientras, siguen llegando por Chrome si las tienes activadas ahí.
- **Descargar Excel** desde B-POS: dentro de la app no baja el archivo (sí en Chrome).
