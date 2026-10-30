# B-POS Agent para Windows (B-POS 2.0)

B-POS se usa en la web (www.bpos.com.mx): cajas, cocina, tablets y celulares
entran con el navegador. En el local solo se instala **B-POS Agent**, y solo en
la computadora que tiene las impresoras y donde llegan los pedidos de
Rappi, Uber Eats y DiDi Food.

`BPOS-Setup-<versión>.exe` instala:

| Qué | Para qué |
|---|---|
| **Impresora virtual** "B-POS Agent Virtual Printer" (puerto 9100) | Ahí se mandan los tickets de las plataformas; el Agent los lee (texto o Tesseract) y los sube al Bridge en la nube |
| **Impresión** | Imprime lo que mandan las pantallas de B-POS (comandas por estación, ticket de la bolsa, ticket original) |
| **Conexión con la nube** | Cada 2 s avisa que está conectado, sus impresoras, y recoge los trabajos de impresión (`lib/cloud-link.js`) |
| **Actualizador automático** | Revisa GitHub Releases al arrancar y cada 6 h; descarga en segundo plano e instala al cerrar |
| **Inicio automático** | Arranca solo al encender la computadora (sin abrir ventanas) |

## Vincular

1. En la web: Configuración → Sistema → **Vincular una computadora** (código
   de 8 letras, dura 15 minutos).
2. En la ventana de B-POS Agent: escribir el código → **Vincular**.

Desde ese momento la tarjeta de Sistema muestra el Agent como "Conectado" con
sus impresoras, y Configuración → Impresoras las ofrece para cada estación.
Desvincular se puede desde la web o desde el Agent.

## Actualizar desde B-POS 1.x

La 1.x se actualiza sola a la 2.0 (o se instala la 2.0 encima): el instalador
quita la versión anterior, borra el sistema local y la regla de firewall del
puerto 3000, y conserva `%APPDATA%\B-POS\data`. Al vincular, el Agent sube a
la nube las equivalencias del Bridge y los pedidos pendientes que había en la
PC.

## Usarlo

- Vive en la **bandeja** (junto al reloj): Abrir B-POS · Ver estado ·
  Buscar actualizaciones · **Reparar instalación** · Abrir carpeta de
  registros · Salir.
- Sin internet o sin vincular, los pedidos leídos esperan en
  `%APPDATA%\B-POS\data\outbox.json` y se suben solos al volver.
- **Registros**: `%APPDATA%\B-POS\logs\bpos.log`.

## Armar y publicar

```
npm run desktop:build     # bpos-agent/dist/BPOS-Setup-<versión>.exe
npm run desktop:release   # además lo publica en GitHub Releases
```

Sube la versión de `bpos-agent/package.json` antes de cada release.
