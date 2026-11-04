import Link from "next/link";

/**
 * Datos del responsable para los textos legales. LEGAL_ADDRESS queda vacío
 * hasta que el titular lo confirme (no se muestra si está vacío).
 */
export const LEGAL_NAME = "B-POS";
export const LEGAL_ADDRESS = "";
export const LEGAL_EMAIL = "soporte@bpos.com.mx";
export const LEGAL_UPDATED = "3 de noviembre de 2026";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black px-4 py-10 text-zinc-200 sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-black text-orange-400">
          ← B-POS
        </Link>
        <h1 className="mt-4 text-3xl font-black text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">Última actualización: {LEGAL_UPDATED}</p>
        <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-black [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
        <p className="mt-12 border-t border-zinc-800 pt-6 text-sm text-zinc-500">
          <Link href="/terminos" className="underline">Términos y condiciones</Link> · <Link href="/privacidad" className="underline">Aviso de privacidad</Link> · {LEGAL_EMAIL}
        </p>
      </article>
    </main>
  );
}
