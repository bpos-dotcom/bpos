"use client";

import { ReactNode, useEffect, useState } from "react";
import { getCurrentUser, UserRole } from "@/lib/auth";

type Props = {
  allow: UserRole[];
  children: ReactNode;
};

export default function RequireRole({ allow, children }: Props) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const user = getCurrentUser();

    if (allow.includes(user.role)) {
      setAuthorized(true);
    } else {
      setAuthorized(false);
    }
  }, [allow]);

  if (authorized === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Verificando permisos...
      </main>
    );
  }

  if (!authorized) {
    window.location.replace("/acceso-denegado");
    return null;
  }

  return <>{children}</>;
}