import type { Metadata } from "next";
import { LEGAL_ADDRESS, LEGAL_EMAIL, LEGAL_NAME, LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Aviso de privacidad · B-POS" };

export default function PrivacidadPage() {
  return (
    <LegalPage title="Aviso de privacidad">
      <p>
        {LEGAL_NAME}
        {LEGAL_ADDRESS ? `, con domicilio en ${LEGAL_ADDRESS},` : ""} es responsable del tratamiento de los datos personales que nos proporcionas, conforme a la Ley Federal de
        Protección de Datos Personales en Posesión de los Particulares (LFPDPPP) y su Reglamento.
      </p>

      <h2>1. Datos que recabamos</h2>
      <ul>
        <li>
          <b>De los negocios que usan B-POS:</b> nombre del negocio, dirección, teléfono, correo, nombre del responsable, datos de facturación del plan y datos de uso del
          sistema.
        </li>
        <li>
          <b>De los empleados del negocio:</b> nombre, puesto, PIN (guardado cifrado) y registros de entrada y salida del checador.
        </li>
        <li>
          <b>De los clientes de cada restaurante</b> (menú digital, kiosco, club de lealtad y pedidos): nombre, teléfono, correo, dirección de entrega, pedidos, puntos o saldo
          del club y opiniones. Estos datos los trata cada restaurante; B-POS los guarda por cuenta de ese restaurante.
        </li>
      </ul>
      <p>No recabamos datos sensibles. Los pagos con tarjeta los procesa Mercado Pago: B-POS no guarda números de tarjeta.</p>

      <h2>2. Para qué los usamos</h2>
      <p>Finalidades necesarias:</p>
      <ul>
        <li>Dar el servicio: cobrar, preparar y entregar pedidos, llevar caja, inventario, clientes y reportes.</li>
        <li>Crear y proteger tu cuenta, enviar códigos de verificación, cortes de caja y avisos del sistema.</li>
        <li>Cobrar el plan contratado y atender soporte y aclaraciones.</li>
      </ul>
      <p>Finalidades adicionales (puedes negarte escribiéndonos):</p>
      <ul>
        <li>Mandarte novedades del servicio y resúmenes por correo.</li>
        <li>Mejorar B-POS con estadísticas de uso que no te identifican.</li>
      </ul>

      <h2>3. Con quién los compartimos</h2>
      <p>
        Solo con proveedores que nos ayudan a dar el servicio y que están obligados a proteger los datos: nube y base de datos, envío de correos, procesamiento de pagos
        (Mercado Pago), tarjetas digitales (Google Wallet) y, cuando el negocio lo activa, inteligencia artificial para analizar ventas. No vendemos datos personales.
      </p>

      <h2>4. Tus derechos ARCO</h2>
      <p>
        Puedes Acceder a tus datos, Rectificarlos, Cancelarlos u Oponerte a su uso, así como revocar tu consentimiento o limitar su uso, escribiendo a{" "}
        <a href={`mailto:${LEGAL_EMAIL}`} className="text-orange-400 underline">{LEGAL_EMAIL}</a> con tu nombre, el dato y lo que solicitas. Te respondemos en un máximo de 20
        días hábiles. Si eres cliente de un restaurante, también puedes pedírselo directamente al restaurante.
      </p>

      <h2>5. Cuánto tiempo los guardamos</h2>
      <p>
        Mientras la cuenta esté activa y el tiempo que exijan las leyes fiscales y comerciales. Al cancelar una cuenta, los datos se eliminan o se anonimizan después de 30 días,
        salvo los que debamos conservar por ley.
      </p>

      <h2>6. Seguridad</h2>
      <p>
        Usamos conexiones cifradas, contraseñas y PIN cifrados, separación de datos entre negocios y respaldos diarios. Cada acción importante queda registrada en una bitácora.
      </p>

      <h2>7. Cookies y almacenamiento local</h2>
      <p>
        B-POS guarda en tu navegador la sesión y los datos del negocio para funcionar más rápido y sincronizar. No usamos cookies de publicidad.
      </p>

      <h2>8. Cambios a este aviso</h2>
      <p>Cualquier cambio lo publicaremos en esta página y, si es importante, te lo avisaremos por correo.</p>
    </LegalPage>
  );
}
