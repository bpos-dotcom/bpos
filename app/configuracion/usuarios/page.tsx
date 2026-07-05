"use client";

import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { UserRole } from "@/lib/auth";

type SystemUser = {
  id: number;
  name: string;
  pin: string;
  role: UserRole;
  active: boolean;
};

const USERS_KEY = "bpos_users";

const defaultUsers: SystemUser[] = [
  {
    id: 1,
    name: "Gerardo",
    pin: "1234",
    role: "Admin",
    active: true,
  },
];

export default function UsuariosAdminPage() {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<UserRole>("Cajero");

  useEffect(() => {
    const saved = localStorage.getItem(USERS_KEY);

    if (saved) {
      setUsers(JSON.parse(saved));
    } else {
      setUsers(defaultUsers);
      localStorage.setItem(USERS_KEY, JSON.stringify(defaultUsers));
    }
  }, []);

  function saveUsers(nextUsers: SystemUser[]) {
    setUsers(nextUsers);
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
  }

  function addUser() {
    if (!name.trim()) {
      alert("Captura el nombre del usuario.");
      return;
    }

    if (pin.length < 4) {
      alert("El PIN debe tener al menos 4 dígitos.");
      return;
    }

    const newUser: SystemUser = {
      id: Date.now(),
      name,
      pin,
      role,
      active: true,
    };

    saveUsers([...users, newUser]);

    setName("");
    setPin("");
    setRole("Cajero");
  }

  function updateUser(
    id: number,
    field: keyof SystemUser,
    value: string | boolean
  ) {
    const nextUsers = users.map((user) =>
      user.id === id ? { ...user, [field]: value } : user
    );

    saveUsers(nextUsers);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Usuarios y Permisos"
        subtitle="Administra empleados, PIN, rol y estado del usuario."
      >
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-xl font-black text-orange-500">
            Agregar usuario
          </h2>

          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr_1fr_auto]">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre del empleado"
              className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
            />

            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="PIN"
              className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
            />

            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className="rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
            >
              <option>Cajero</option>
              <option>Gerente</option>
              <option>Admin</option>
            </select>

            <button
              onClick={addUser}
              className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black"
            >
              Agregar
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-xl font-black text-orange-500">
            Usuarios registrados
          </h2>

          <div className="mt-6 space-y-3">
            {users.map((user) => (
              <div
                key={user.id}
                className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-800 bg-black p-4 xl:grid-cols-[2fr_1fr_1fr_1fr]"
              >
                <input
                  value={user.name}
                  onChange={(event) =>
                    updateUser(user.id, "name", event.target.value)
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                />

                <input
                  value={user.pin}
                  onChange={(event) =>
                    updateUser(user.id, "pin", event.target.value)
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                />

                <select
                  value={user.role}
                  onChange={(event) =>
                    updateUser(user.id, "role", event.target.value as UserRole)
                  }
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-white"
                >
                  <option>Cajero</option>
                  <option>Gerente</option>
                  <option>Admin</option>
                </select>

                <button
                  onClick={() => updateUser(user.id, "active", !user.active)}
                  className={`rounded-xl px-3 py-2 font-black ${
                    user.active
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {user.active ? "Activo" : "Inactivo"}
                </button>
              </div>
            ))}
          </div>
        </section>
      </AppShell>
    </RequireRole>
  );
}