export default function AccesoDenegadoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <section className="max-w-md rounded-3xl border border-red-500/30 bg-zinc-950 p-8 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-red-500/10 text-5xl">
          🔒
        </div>

        <h1 className="mt-6 text-3xl font-black text-red-400">
          Acceso denegado
        </h1>

        <p className="mt-3 text-zinc-400">
          Tu usuario no tiene permisos para entrar a esta sección.
        </p>

        <a
          href="/pos"
          className="mt-6 inline-block rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
        >
          Volver al POS
        </a>
      </section>
    </main>
  );
}