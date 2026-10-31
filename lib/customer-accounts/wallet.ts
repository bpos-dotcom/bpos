/**
 * Tarjeta del club en Google Wallet (solo en Vercel). Arma la liga
 * "Agregar a Google Wallet" firmada con la cuenta de servicio del emisor.
 *
 * Para activarlo (una vez, en la consola de Google Pay & Wallet):
 *   GOOGLE_WALLET_ISSUER_ID         número de emisor
 *   GOOGLE_WALLET_SERVICE_ACCOUNT   JSON de la cuenta de servicio (client_email, private_key)
 * Mientras Google no apruebe al emisor, solo funciona con las cuentas de
 * prueba registradas en la consola.
 */
import { createSign } from "node:crypto";

export const walletReady = () => Boolean(process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SERVICE_ACCOUNT);

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function walletSaveUrl(p: {
  businessId: string;
  businessName: string;
  clubName: string;
  color: string;
  logoUrl: string;
  accountId: string;
  customerName: string;
  code: string;
  balanceLabel: string;
  balanceText: string;
}) {
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID!;
  const account = JSON.parse(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT!) as { client_email: string; private_key: string };
  const classId = `${issuer}.bpos-${p.businessId.replace(/-/g, "")}`;
  const claims = {
    iss: account.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: ["https://www.bpos.com.mx"],
    payload: {
      loyaltyClasses: [
        {
          id: classId,
          issuerName: p.businessName.slice(0, 40),
          programName: p.clubName.slice(0, 40),
          programLogo: { sourceUri: { uri: p.logoUrl } },
          hexBackgroundColor: p.color,
          reviewStatus: "UNDER_REVIEW",
        },
      ],
      loyaltyObjects: [
        {
          id: `${issuer}.m-${p.accountId.replace(/-/g, "")}`,
          classId,
          state: "ACTIVE",
          accountId: p.code,
          accountName: p.customerName.slice(0, 40),
          loyaltyPoints: { label: p.balanceLabel, balance: { string: p.balanceText } },
          barcode: { type: "QR_CODE", value: p.code, alternateText: p.code },
        },
      ],
    },
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return `https://pay.google.com/gp/v/save/${unsigned}.${b64url(signature)}`;
}
