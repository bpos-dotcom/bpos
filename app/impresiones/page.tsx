"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  getPrintJobs,
  PrintJob,
  reprintJob,
  sendPendingPrintJobsToLocalService,
} from "@/lib/bridge/printManager";

export default function ImpresionesPage() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);

  useEffect(() => {
    loadJobs();

    const timer = setInterval(loadJobs, 1000);

    return () => clearInterval(timer);
  }, []);

  function loadJobs() {
    setJobs(getPrintJobs().reverse());
  }

  function reprint(jobId: number) {
    reprintJob(jobId);
    loadJobs();
    alert("Comanda enviada a reimpresión.");
  }

  function previewTicket(content: string) {
    alert(content);
  }

  async function sendPendingJobs() {
  try {
    const count = await sendPendingPrintJobsToLocalService();
    alert(`${count} comandas enviadas al B-POS Local Service.`);
  } catch (error) {
    alert("No se pudo conectar con B-POS Local Service.");
  }
}

  const pendingJobs = jobs.filter((job) => job.status === "Pendiente");
  const reprints = jobs.filter((job) => job.reprintOf);

  return (
    <AppShell
      title="Print Manager"
      subtitle="Reimpresión de comandas por estación."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Metric title="Pendientes" value={pendingJobs.length.toString()} />
        <Metric title="Reimpresiones" value={reprints.length.toString()} />
      </div>

      <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h2 className="text-xl font-black text-orange-500">
          Cola de impresión
          <button
  onClick={sendPendingJobs}
  className="mt-4 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
>
  Enviar pendientes al servicio local
</button>
        </h2>

        <div className="mt-6 space-y-4">
          {jobs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
              Todavía no hay trabajos de impresión.
            </div>
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                className="rounded-2xl border border-zinc-800 bg-black p-5"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-orange-500">
                      {job.station}
                    </p>

                    <h3 className="text-2xl font-black">
                      Pedido #{job.orderId.toString().padStart(6, "0")}
                    </h3>

                    <p className="mt-1 text-sm text-zinc-400">
                      {job.printerName} ·{" "}
                      {new Date(job.createdAt).toLocaleString()}
                    </p>

                    {job.reprintOf && (
                      <p className="mt-2 inline-block rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-xs font-black text-yellow-300">
                        🔄 Reimpresión
                      </p>
                    )}
                  </div>

                  <span className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs font-black text-yellow-300">
                    {job.status}
                  </span>
                </div>

                <pre className="mt-4 max-h-48 overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-xs leading-5 text-zinc-400">
                  {job.content}
                </pre>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => previewTicket(job.content)}
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black text-white"
                  >
                    Ver ticket
                  </button>

                  <button
                    onClick={() => reprint(job.id)}
                    className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-black text-black"
                  >
                    Reimprimir comanda
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-2 text-3xl font-black text-orange-500">{value}</p>
    </div>
  );
}