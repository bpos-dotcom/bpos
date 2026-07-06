# B-POS Agent Virtual Printer

Objetivo:
Crear una impresora virtual universal llamada "B-POS Agent".

Flujo:
Didi/Uber/Rappi imprime hacia B-POS Agent.
Windows envía el trabajo al puerto local.
B-POS Agent recibe el ticket.
B-POS interpreta el pedido.
B-POS crea venta, inventario, KDS e impresión por estación.

No debe depender de XPrinter, Epson ni ninguna marca específica.
La impresora física se configura aparte por estación.