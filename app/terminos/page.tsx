import type { Metadata } from "next";
import { LEGAL_EMAIL, LEGAL_NAME, LegalPage } from "@/components/legal/LegalPage";
import { TRIAL_DAYS } from "@/lib/plans";

export const metadata: Metadata = { title: "Términos y condiciones · B-POS" };

export default function TerminosPage() {
  return (
    <LegalPage title="Términos y condiciones">
      <p>
        Estos términos regulan el uso de {LEGAL_NAME}, el punto de venta en la nube para restaurantes disponible en bpos.com.mx, sus aplicaciones (caja, cocina, meseros,
        app del dueño, menú digital y kiosco) y B-POS Agent. Al crear una cuenta o usar el servicio, aceptas estos términos.
      </p>

      <h2>1. El servicio</h2>
      <p>
        B-POS permite cobrar, mandar comandas a cocina, llevar inventario, caja, clientes y reportes, y recibir pedidos del menú digital y de plataformas de delivery.
        Funciona por internet: sin conexión no es posible registrar ventas en el sistema.
      </p>

      <h2>2. Cuenta y prueba gratis</h2>
      <ul>
        <li>Al registrarte recibes {TRIAL_DAYS} días de prueba sin costo y sin tarjeta.</li>
        <li>Eres responsable de la contraseña de la cuenta, de los PIN de tus empleados y de los dispositivos que vinculas (computadoras, tablets y celulares).</li>
        <li>Los datos que capturas deben ser verdaderos y de tu negocio.</li>
      </ul>

      <h2>3. Planes y pagos</h2>
      <ul>
        <li>El servicio se paga por mes y por sucursal, según el plan elegido en Configuración → Mi plan. Los precios se muestran en pesos mexicanos.</li>
        <li>El cobro se hace por medio de Mercado Pago. Si un pago no se completa, el acceso puede limitarse hasta regularizarlo.</li>
        <li>Puedes cancelar cuando quieras desde Mi plan; el servicio sigue activo hasta el final del periodo pagado y no hay reembolsos por periodos parciales.</li>
        <li>Podemos ajustar precios avisándote con al menos 30 días de anticipación.</li>
      </ul>

      <h2>4. Tus datos</h2>
      <p>
        La información de tu negocio (productos, ventas, clientes, inventario) es tuya. Nosotros la guardamos y procesamos solo para darte el servicio, conforme al{" "}
        <a href="/privacidad" className="text-orange-400 underline">aviso de privacidad</a>. Puedes descargar respaldos en Configuración → Respaldos. Si cancelas, puedes
        pedirnos una copia de tus datos dentro de los 30 días siguientes.
      </p>

      <h2>5. Uso correcto</h2>
      <ul>
        <li>No usar B-POS para actividades ilícitas ni para registrar información de terceros sin su consentimiento.</li>
        <li>No intentar acceder a datos de otros negocios ni afectar el funcionamiento del servicio.</li>
        <li>Si recibes pedidos de clientes por el menú digital o el kiosco, tú eres responsable de los productos, precios, entregas y cobros frente a tus clientes.</li>
      </ul>

      <h2>6. Servicios de terceros</h2>
      <p>
        Algunas funciones dependen de terceros (Mercado Pago, plataformas de delivery, WhatsApp, Google Wallet, proveedores de nube y de correo). Su uso se rige además por
        sus propios términos, y no respondemos por fallas o cambios de esos servicios.
      </p>

      <h2>7. Disponibilidad y responsabilidad</h2>
      <p>
        Trabajamos para que B-POS esté disponible y funcione correctamente, pero el servicio se ofrece &quot;tal cual&quot; y puede tener interrupciones por mantenimiento, fallas de
        internet o de proveedores. En la medida que permita la ley, nuestra responsabilidad total se limita a lo que pagaste por el servicio en los últimos tres meses. No somos
        responsables por pérdidas indirectas, como ventas no realizadas.
      </p>

      <h2>8. Facturación fiscal</h2>
      <p>B-POS no emite facturas (CFDI) a tus clientes por ahora. Las obligaciones fiscales de tu negocio son tuyas.</p>

      <h2>9. Cambios a estos términos</h2>
      <p>Podemos actualizar estos términos; los cambios importantes te los avisaremos por correo o dentro del sistema. Seguir usando B-POS significa que los aceptas.</p>

      <h2>10. Contacto y ley aplicable</h2>
      <p>
        Dudas o aclaraciones: <a href={`mailto:${LEGAL_EMAIL}`} className="text-orange-400 underline">{LEGAL_EMAIL}</a>. Estos términos se rigen por las leyes de los Estados
        Unidos Mexicanos.
      </p>
    </LegalPage>
  );
}
