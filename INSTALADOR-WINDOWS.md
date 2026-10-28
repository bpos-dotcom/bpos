# B-POS para Windows (bloque 13)

Un solo instalador, `BPOS-Setup-<versión>.exe`, deja lista la computadora de la caja:

| Qué instala | Para qué |
|---|---|
| **Sistema B-POS** (build de producción) | Corre en segundo plano en el puerto 3000; las cajas, la cocina y los celulares de la red lo abren igual que antes |
| **B-POS Agent** | Impresión térmica (4850) e impresora virtual "B-POS Agent Virtual Printer" (9100) para los tickets de Rappi/Uber/DiDi |
| **Actualizador automático** | Revisa GitHub Releases al arrancar y cada 6 h; descarga en segundo plano e instala al cerrar B-POS |
| **Inicio automático** | B-POS arranca solo al encender la computadora (sin abrir ventanas) |
| **Regla de firewall** | Permite que los dispositivos de la red privada entren al puerto 3000 |

Ya no hace falta Node.js ni `INICIAR-BPOS.bat` en la caja.

## Usarlo

- B-POS vive en la **bandeja** (junto al reloj). Clic derecho en el ícono:
  Abrir B-POS · App del dueño · Ver estado · Buscar actualizaciones ·
  Reiniciar servidor · **Reparar instalación** · Abrir carpeta de registros · Salir.
- **Ver estado** muestra la versión, si el sistema está funcionando, el avance
  de las actualizaciones y el registro reciente.
- **Reparar instalación** revisa los archivos, reinstala la impresora virtual
  (Windows pide permiso de administrador), reactiva el inicio automático y
  reinicia el servidor.
- **Registros**: `%APPDATA%\B-POS\logs\bpos.log` (se rota a los 5 MB, guarda 5).
- **Datos del Bridge**: `%APPDATA%\B-POS\data`.

## Desinstalar

Panel de control → Programas → B-POS → Desinstalar. Quita la impresora
virtual, la regla de firewall y el inicio automático, y pregunta si borrar
los registros y archivos locales. Las ventas, productos e inventario están en
la nube y no se borran.

## Antes de instalar en una caja que ya usaba B-POS

1. Cierra la ventana de `INICIAR-BPOS.bat` (usa el mismo puerto 3000).
2. Instala `BPOS-Setup-<versión>.exe`. Si había un B-POS Agent viejo, se
   reemplaza solo.
3. Abre B-POS desde la bandeja. Se abre en el mismo navegador y la misma
   dirección (`http://localhost:3000`), así que los datos de ese navegador
   siguen ahí.

## Sacar una versión nueva (para quien programa)

1. Sube `version` en `bpos-agent/package.json` (ej. 1.1.0 → 1.2.0).
2. `npm run desktop:build`: arma `bpos-agent/dist/BPOS-Setup-<versión>.exe` para probar.
3. `npm run desktop:release`: arma y **publica** en GitHub Releases de
   `bpos-dotcom/bpos` (usa la sesión de `gh auth login`). Las cajas la
   descargan solas en las siguientes horas.

> El instalador no está firmado con un certificado de código: Windows
> SmartScreen muestra "Windows protegió su PC" → **Más información** →
> **Ejecutar de todas formas**. Para quitar ese aviso hace falta comprar un
> certificado de firma de código.
