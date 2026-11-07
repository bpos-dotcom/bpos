/**
 * Textos de venta de cada servicio de B-POS por separado: el título, la
 * explicación y las ventajas que se ven en bpos.com.mx/servicios (sin
 * cuenta) y en el panel de Mis servicios. Qué incluye cada uno está en
 * SERVICES (lib/services.ts).
 */
import type { ServiceId } from "@/lib/services";

export type ServicePitch = { headline: string; pitch: string; benefits: { title: string; text: string }[] };

export const SERVICE_PITCH: Record<ServiceId, ServicePitch> = {
  lealtad: {
    headline: "Que tus clientes regresen por su premio",
    pitch: "Un club de clientes como el de las grandes cadenas, sin cambiar tu punto de venta. El cliente se une con un QR, guarda su tarjeta en Google Wallet y junta puntos, sellos o cashback cada vez que te compra.",
    benefits: [
      { title: "Más visitas", text: "Con su tarjeta en el celular, tu cliente tiene un motivo para volver contigo y no con la competencia." },
      { title: "Sin apps ni plástico", text: "La tarjeta vive en su celular: no descarga nada y no se le pierde." },
      { title: "Conoces a tus clientes", text: "Sabes quién te compra, cuánto y cada cuándo, y les escribes por WhatsApp." },
    ],
  },
  menu: {
    headline: "Tu menú en el celular de tus clientes",
    pitch: "Un menú con fotos que se abre con un QR en la mesa, en Instagram o en WhatsApp. Tus clientes piden para recoger o a domicilio, pagan en línea y el pedido te llega al momento.",
    benefits: [
      { title: "Sin comisión por pedido", text: "A diferencia de las apps de delivery, lo que vendes por tu menú es todo tuyo." },
      { title: "Cambios al instante", text: "Precios, fotos y platillos agotados se actualizan sin reimprimir nada." },
      { title: "Listo en minutos", text: "Sube tu menú desde el Excel de Soft Restaurant o de tu sistema actual." },
    ],
  },
  kiosco: {
    headline: "Que el cliente pida y pague solo",
    pitch: "Una pantalla táctil en tu mostrador con tu menú digital: el cliente arma su pedido, paga con la terminal Point de Mercado Pago y sale su ticket. Tu equipo solo prepara y entrega.",
    benefits: [
      { title: "Menos filas", text: "Mientras unos piden en el kiosco, tu cajero atiende a los demás." },
      { title: "Pedidos sin errores", text: "El cliente elige exactamente lo que quiere, con sus opciones y comentarios." },
      { title: "Cobro con tarjeta", text: "Paga en la terminal y queda registrado; menos efectivo que cuadrar." },
    ],
  },
  asesor: {
    headline: "Un consultor que lee tus reportes por ti",
    pitch: "Sube los reportes en Excel o CSV que ya descargas de DiDi, Uber, Rappi o tu punto de venta. La inteligencia artificial los lee, te dice cómo va tu negocio y qué hacer esta semana para vender más.",
    benefits: [
      { title: "Tus números en minutos", text: "Sin tablas ni fórmulas: un resumen claro con las cifras de tus propios reportes." },
      { title: "Alertas a tiempo", text: "Te avisa de comisiones altas, días flojos o platillos que dejan poco." },
      { title: "Pregúntale lo que quieras", text: "¿Qué día vendo menos? ¿Cuánto me cobró DiDi? Te responde con tus datos." },
    ],
  },
  foodcost: {
    headline: "Sabe cuánto ganas en cada platillo",
    pitch: "Un asistente paso a paso: escribe qué lleva tu platillo y cuánto pagas por cada cosa, y B-POS calcula su costo, su food cost y el precio sugerido. Si vendes en apps, te dice a cuánto publicarlo en cada una para no perder.",
    benefits: [
      { title: "Precios con números, no a ojo", text: "Ves el costo real de cada platillo, con ingredientes y empaque." },
      { title: "Las apps sin sorpresas", text: "Toma en cuenta la comisión y los impuestos de DiDi, Uber y Rappi antes de que te cobren." },
      { title: "Promociones que sí dejan", text: "Ve cuánto recibes de verdad con un descuento antes de lanzarlo." },
    ],
  },
  checador: {
    headline: "Las horas de tu equipo, sin hojas ni pleitos",
    pitch: "Tus empleados checan su entrada y salida con su PIN en una tablet o celular del negocio. Tú ves quién llegó, a qué hora y cuántas horas trabajó cada uno.",
    benefits: [
      { title: "Nómina más fácil", text: "Horas por día y por persona, listas para descargar en Excel." },
      { title: "Sin aparatos caros", text: "Usa una tablet o un celular que ya tengas en el negocio." },
      { title: "Cuentas claras", text: "Cada entrada y salida queda registrada con su hora." },
    ],
  },
};
