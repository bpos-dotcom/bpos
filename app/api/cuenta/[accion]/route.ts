import { NextResponse, type NextRequest } from "next/server";
import { randomInt } from "node:crypto";
import { balanceLabel, clubName, howItWorks, normalizeLoyalty, welcomeLabel, type LoyaltyConfig } from "@/lib/loyalty";
import { walletReady, walletSaveUrl } from "@/lib/customer-accounts/wallet";
import {
  Friendly,
  admin,
  checkNewPassword,
  checkPassword,
  cleanEmail,
  cleanPhone,
  findAccount,
  hashPassword,
  maskEmail,
  openSession,
  publicAccount,
  restaurant,
  sendCode,
  sessionAccount,
  redeemCode,
  validEmail,
  type Account,
} from "@/lib/customer-accounts/server";

/**
 * Cuenta del cliente en el menú digital de un restaurante:
 *   POST /api/cuenta/registro     { slug, name, phone, email, password } → manda código
 *   POST /api/cuenta/verificar    { slug, phone, code }                  → { token, account }
 *   POST /api/cuenta/reenviar     { slug, phone }
 *   POST /api/cuenta/entrar       { slug, phone, password }              → { token, account } o { needsCode }
 *   POST /api/cuenta/olvide       { slug, phone }                        → manda código
 *   POST /api/cuenta/restablecer  { slug, phone, code, password }        → { token, account }
 *   POST /api/cuenta/yo           { slug }  (Bearer)                     → { account, orders }
 *   POST /api/cuenta/vincular     { slug, orderId, orderToken } (Bearer) → guarda el pedido en su historial
 *   POST /api/cuenta/salir        { slug }  (Bearer)
 *   POST /api/cuenta/club         { slug }  (Bearer opcional)            → club, socio y movimientos
 *   POST /api/cuenta/unirme       { slug }  (Bearer)                     → entra al club (con su regalo)
 *   POST /api/cuenta/wallet       { slug }  (Bearer)                     → liga "Agregar a Google Wallet"
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;
type Member = { account_id: string; code: string; points: number; stamps: number; cashback: number; joined_at: string };

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newMemberCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join("");

/** Lo que el cliente ve del club (sin datos internos) */
function publicClub(c: LoyaltyConfig, business: string) {
  return {
    enabled: c.enabled,
    name: clubName(c, business),
    kind: c.kind,
    how: howItWorks(c),
    welcome: welcomeLabel(c),
    rewards: c.kind === "puntos" ? c.rewards.map((r) => ({ name: r.name, points: r.points })) : [],
    stampsGoal: c.stampsGoal,
    stampReward: c.stampReward,
    links: Object.fromEntries(Object.entries(c.links).filter(([, l]) => l.on && l.url).map(([k, l]) => [k, l.url])),
    terms: c.terms,
  };
}
const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export async function POST(request: NextRequest, ctx: { params: Promise<{ accion: string }> }) {
  const { accion } = await ctx.params;
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Petición inválida." }, { status: 400 });
  }
  try {
    const db = admin();
    const shop = await restaurant(db, str(body.slug, 60));
    const phone = cleanPhone(body.phone);
    const needPhone = () => {
      if (phone.length !== 10) throw new Friendly("Escribe tu teléfono a 10 dígitos.");
    };
    const signedIn = async (account: Account) => NextResponse.json({ token: await openSession(db, account.id), account: publicAccount(account) });

    switch (accion) {
      case "registro": {
        needPhone();
        // Sin correo configurado no se crean cuentas a medias
        if (!process.env.RESEND_API_KEY) throw new Friendly("El registro todavía no está disponible. Intenta más tarde.", 503);
        const name = str(body.name, 60);
        const email = cleanEmail(body.email);
        const password = String(body.password ?? "");
        if (name.length < 2) throw new Friendly("Escribe tu nombre.");
        if (!validEmail(email)) throw new Friendly("Escribe un correo válido.");
        checkNewPassword(password);
        let account = await findAccount(db, shop.businessId, phone);
        if (account?.email_verified_at) throw new Friendly("Ese teléfono ya tiene cuenta. Entra con tu contraseña.", 409);
        const fields = { name, email, password_hash: hashPassword(password), updated_at: new Date().toISOString() };
        if (account) {
          const { data, error } = await db.from("bpos_customer_accounts").update(fields).eq("id", account.id).select("*").single();
          if (error) throw new Error(error.message);
          account = data as Account;
        } else {
          const { data, error } = await db.from("bpos_customer_accounts").insert({ business_id: shop.businessId, phone, ...fields }).select("*").single();
          if (error) throw new Error(error.message);
          account = data as Account;
        }
        await sendCode(db, account, "verificar", shop);
        return NextResponse.json({ sent: true, email: maskEmail(email) });
      }

      case "reenviar": {
        needPhone();
        const account = await findAccount(db, shop.businessId, phone);
        if (!account || account.email_verified_at) return NextResponse.json({ sent: true });
        await sendCode(db, account, "verificar", shop);
        return NextResponse.json({ sent: true, email: maskEmail(account.email) });
      }

      case "verificar": {
        needPhone();
        const account = await findAccount(db, shop.businessId, phone);
        if (!account) throw new Friendly("No encontramos tu cuenta. Regístrate otra vez.");
        await redeemCode(db, account, "verificar", str(body.code, 10));
        const { data } = await db
          .from("bpos_customer_accounts")
          .update({ email_verified_at: new Date().toISOString(), failed_logins: 0, locked_until: null, updated_at: new Date().toISOString() })
          .eq("id", account.id)
          .select("*")
          .single();
        return signedIn((data as Account) || account);
      }

      case "entrar": {
        needPhone();
        const password = String(body.password ?? "");
        const account = await findAccount(db, shop.businessId, phone);
        if (!account || !account.password_hash) throw new Friendly("Teléfono o contraseña incorrectos.", 401);
        if (account.locked_until && Date.parse(account.locked_until) > Date.now()) throw new Friendly("Demasiados intentos. Espera 15 minutos o cambia tu contraseña.", 429);
        if (!checkPassword(password, account.password_hash)) {
          const failed = account.failed_logins + 1;
          await db
            .from("bpos_customer_accounts")
            .update({ failed_logins: failed >= 8 ? 0 : failed, locked_until: failed >= 8 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null })
            .eq("id", account.id);
          throw new Friendly("Teléfono o contraseña incorrectos.", 401);
        }
        if (account.failed_logins) await db.from("bpos_customer_accounts").update({ failed_logins: 0, locked_until: null }).eq("id", account.id);
        if (!account.email_verified_at) {
          await sendCode(db, account, "verificar", shop);
          return NextResponse.json({ needsCode: true, email: maskEmail(account.email) });
        }
        return signedIn(account);
      }

      case "olvide": {
        needPhone();
        const account = await findAccount(db, shop.businessId, phone);
        // Misma respuesta exista o no la cuenta
        if (account?.email) await sendCode(db, account, "contrasena", shop);
        return NextResponse.json({ sent: true, email: account?.email ? maskEmail(account.email) : "" });
      }

      case "restablecer": {
        needPhone();
        const password = String(body.password ?? "");
        checkNewPassword(password);
        const account = await findAccount(db, shop.businessId, phone);
        if (!account) throw new Friendly("El código no es correcto.");
        await redeemCode(db, account, "contrasena", str(body.code, 10));
        const { data } = await db
          .from("bpos_customer_accounts")
          .update({
            password_hash: hashPassword(password),
            email_verified_at: account.email_verified_at || new Date().toISOString(),
            failed_logins: 0,
            locked_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id)
          .select("*")
          .single();
        // Las demás sesiones se cierran al cambiar la contraseña
        await db.from("bpos_customer_sessions").delete().eq("account_id", account.id);
        return signedIn((data as Account) || account);
      }

      case "yo": {
        const { account } = await sessionAccount(db, request.headers.get("authorization"), shop.businessId);
        const { data: orders } = await db
          .from("bpos_online_orders")
          .select("id, token, folio, status, data, created_at, branch_id")
          .eq("account_id", account.id)
          .order("created_at", { ascending: false })
          .limit(50);
        return NextResponse.json({ account: publicAccount(account), orders: orders || [] });
      }

      case "vincular": {
        const { account } = await sessionAccount(db, request.headers.get("authorization"), shop.businessId);
        const orderId = str(body.orderId, 40);
        const orderToken = str(body.orderToken, 40);
        const { data: order } = await db
          .from("bpos_online_orders")
          .select("id, business_id, account_id, created_at, data")
          .eq("id", orderId)
          .eq("token", orderToken)
          .maybeSingle();
        if (!order || order.business_id !== shop.businessId) throw new Friendly("No encontramos ese pedido.", 404);
        if (!order.account_id && Date.now() - Date.parse(order.created_at) < 24 * 60 * 60 * 1000) {
          await db.from("bpos_online_orders").update({ account_id: account.id }).eq("id", order.id);
        }
        // Se guarda su última dirección de entrega para el siguiente pedido
        const c = (order.data as { type?: string; customer?: { address?: string; reference?: string; location?: unknown } })?.customer;
        if ((order.data as { type?: string })?.type === "Domicilio" && c?.address) {
          await db
            .from("bpos_customer_accounts")
            .update({ address: { address: c.address, reference: c.reference || "", ...(c.location ? { location: c.location } : {}) }, updated_at: new Date().toISOString() })
            .eq("id", account.id);
        }
        return NextResponse.json({ ok: true });
      }

      case "salir": {
        const { tokenHash } = await sessionAccount(db, request.headers.get("authorization"), shop.businessId);
        await db.from("bpos_customer_sessions").delete().eq("token_hash", tokenHash);
        return NextResponse.json({ ok: true });
      }

      case "club":
      case "unirme":
      case "wallet": {
        const { data: cfgRow } = await db
          .from("sync_records")
          .select("data")
          .eq("business_id", shop.businessId)
          .eq("scope", "business")
          .eq("collection", "bpos_loyalty")
          .eq("record_id", "__doc__")
          .maybeSingle();
        const config = normalizeLoyalty(cfgRow?.data);
        const business = { name: shop.name, color: shop.color, logo: shop.logo, slug: shop.slug };
        const club = publicClub(config, shop.name);
        const auth = request.headers.get("authorization");

        if (accion === "club" && !auth) return NextResponse.json({ business, club, account: null, member: null, movements: [], wallet: walletReady() });
        const { account } = await sessionAccount(db, auth, shop.businessId);
        const memberQuery = () => db.from("bpos_loyalty_members").select("account_id, code, points, stamps, cashback, joined_at").eq("account_id", account.id).maybeSingle();
        let { data: member } = await memberQuery();

        if (accion === "unirme" && !member) {
          if (!config.enabled) throw new Friendly("Por ahora el club no está activo.");
          const welcome = config.welcomeAmount;
          const gift = {
            points: config.kind === "puntos" ? Math.round(welcome) : 0,
            stamps: config.kind === "sellos" ? Math.round(welcome) : 0,
            cashback: config.kind === "cashback" ? Math.round(welcome * 100) / 100 : 0,
          };
          for (let i = 0; i < 5 && !member; i += 1) {
            const { error } = await db.from("bpos_loyalty_members").insert({ account_id: account.id, business_id: shop.businessId, code: newMemberCode(), ...gift });
            if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
            ({ data: member } = await memberQuery());
          }
          if (!member) throw new Error("No se pudo crear la tarjeta.");
          if (gift.points || gift.stamps || gift.cashback || config.welcomeText) {
            await db.from("bpos_loyalty_movements").insert({ business_id: shop.businessId, account_id: account.id, kind: "bienvenida", ...gift, ref: "bienvenida", note: config.welcomeText });
          }
        }

        if (accion === "wallet") {
          if (!member) throw new Friendly("Primero únete al club.");
          if (!walletReady()) throw new Friendly("Google Wallet estará disponible muy pronto.", 503);
          const m = member as Member;
          const url = walletSaveUrl({
            businessId: shop.businessId,
            businessName: shop.name,
            clubName: club.name,
            color: shop.color,
            logoUrl: `https://www.bpos.com.mx/m/${shop.slug}/icono?size=192`,
            accountId: account.id,
            customerName: account.name,
            code: m.code,
            balanceLabel: config.kind === "sellos" ? "Sellos" : config.kind === "cashback" ? "Saldo" : "Puntos",
            balanceText: balanceLabel(config, m),
          });
          await db.from("bpos_loyalty_members").update({ wallet_saved: true }).eq("account_id", account.id);
          return NextResponse.json({ url });
        }

        const { data: movements } = member
          ? await db
              .from("bpos_loyalty_movements")
              .select("kind, points, stamps, cashback, amount, note, created_at")
              .eq("account_id", account.id)
              .order("created_at", { ascending: false })
              .limit(20)
          : { data: [] };
        return NextResponse.json({ business, club, account: publicAccount(account), member: member || null, movements: movements || [], wallet: walletReady() });
      }

      default:
        return NextResponse.json({ error: "No existe." }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof Friendly) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[B-POS] cuenta de cliente:", e);
    return NextResponse.json({ error: "Algo falló. Intenta otra vez." }, { status: 500 });
  }
}
