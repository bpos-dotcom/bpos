"use client";

import { useEffect, useState } from "react";
import { setCurrentUser } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { getUsers, migrateUserPins, type SystemUser } from "@/lib/users";
import { verifyPin } from "@/lib/pin-hash";
import { getBusinessSettings } from "@/lib/business-settings";

export default function LoginPage() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SystemUser | null>(null);
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [brand, setBrand] = useState("B-POS");

  useEffect(() => {
    setBrand(getBusinessSettings().businessName || "B-POS");
    const load = () => setUsers(getUsers().filter((user) => user.active));
    // Los PIN viejos (texto) se cifran aquí la primera vez
    void migrateUserPins().then(load);
    window.addEventListener("bpos:users-updated", load);
    return () => window.removeEventListener("bpos:users-updated", load);
  }, []);

  async function login() {
    if (!selectedUser) {
      alert("Selecciona un usuario.");
      return;
    }

    setChecking(true);
    const ok = await verifyPin(pin, getUsers().find((u) => u.id === selectedUser.id) || selectedUser);
    setChecking(false);
    if (!ok) {
      addAuditEvent({category:"Seguridad",action:"login.failed",description:`PIN incorrecto para ${selectedUser.name}`,entityId:String(selectedUser.id),metadata:{userName:selectedUser.name}});
      alert("PIN incorrecto.");
      setPin("");
      return;
    }

    setCurrentUser({
      id: selectedUser.id,
      name: selectedUser.name,
      role: selectedUser.role,
    });

    addAuditEvent({category:"Seguridad",action:"login.success",description:`${selectedUser.name} inició sesión`,userId:String(selectedUser.id),userName:selectedUser.name});
    // Regresa a la página que pidió el PIN (solo rutas internas)
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <section className="w-full max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-2xl font-black text-black">
          BP
        </div>

        {!selectedUser ? (
          <>
            <h1 className="text-center text-3xl font-black">
              {brand}
            </h1>

            <p className="mt-2 text-center text-zinc-400">
              ¿Quién está usando el sistema?
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    setSelectedUser(user);
                    setPin("");
                  }}
                  className="rounded-2xl border border-zinc-800 bg-black p-5 text-left transition hover:border-orange-500"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-3xl">
                      👤
                    </div>

                    <div>
                      <p className="text-lg font-black">{user.name}</p>
                      <p className="text-sm text-zinc-500">Tocar para entrar</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {users.length === 0 && (
              <div className="mt-8 rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">
                No hay usuarios activos.
              </div>
            )}
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setSelectedUser(null);
                setPin("");
              }}
              className="mb-6 rounded-2xl border border-zinc-800 bg-black px-4 py-2 text-sm font-bold text-zinc-400 hover:border-orange-500 hover:text-orange-500"
            >
              ← Cambiar usuario
            </button>

            <div className="text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-black text-6xl">
                👤
              </div>

              <p className="mt-6 text-sm font-bold text-orange-500">
                Bienvenido
              </p>

              <h1 className="mt-2 text-4xl font-black">
                {selectedUser.name}
              </h1>

              <p className="mt-2 text-zinc-400">
                Ingresa tu PIN para continuar.
              </p>
            </div>

            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !checking) void login();
              }}
              placeholder="••••"
              type="password"
              inputMode="numeric"
              autoFocus
              className="mt-8 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-5 text-center text-3xl tracking-[0.6em] text-white"
            />

            <button
              onClick={() => void login()}
              disabled={checking}
              className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black transition hover:bg-orange-400"
            >
              {checking ? "Revisando..." : "Entrar"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}