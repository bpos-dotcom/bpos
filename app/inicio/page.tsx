"use client";
/**
 * Inicio de B-POS (la app instalada y "Ir al inicio" llegan aquí): manda a
 * cada usuario a su primera pantalla permitida (el POS para quien vende, la
 * App del dueño o el Dashboard para quien no). Sin sesión, al PIN.
 */
import { useEffect } from "react";
import { getSessionUser } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";

export default function Inicio() {
  useEffect(() => {
    const user = getSessionUser();
    window.location.replace(user ? homePathFor(user) : "/login?next=%2Finicio");
  }, []);
  return <main className="flex min-h-screen items-center justify-center bg-black text-zinc-500">Abriendo B-POS…</main>;
}
