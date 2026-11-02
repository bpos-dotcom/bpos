"use client";
import { ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { InventoryOrderProcessor } from "@/components/inventory/InventoryOrderProcessor";
import { getSessionUser, redirectToLogin } from "@/lib/auth";
import { hasPermission, permissionForPath } from "@/lib/permissions";
import { addAuditEvent } from "@/lib/audit";
import { getBusinessSettings } from "@/lib/business-settings";
import { TopCorner } from "@/components/layout/TopCorner";
import { BackButton } from "@/components/layout/BackButton";
export function AppShell({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}){
 const pathname=usePathname();const[allowed,setAllowed]=useState<boolean|null>(null);
 // Marca blanca: el nombre del negocio (Configuración → Empresa) · B-POS
 const[brand,setBrand]=useState("B-POS");
 useEffect(()=>{const name=getBusinessSettings().businessName;setBrand(name?`${name} · B-POS`:"B-POS");},[]);
 useEffect(()=>{const user=getSessionUser();if(!user){redirectToLogin();return;}const permission=permissionForPath(pathname);const ok=!permission||hasPermission(user,permission);setAllowed(ok);if(!ok){addAuditEvent({category:"Seguridad",action:"access.denied",description:`${user.name} intentó abrir ${pathname}`,userId:String(user.id),userName:user.name,metadata:{pathname,permission}});window.location.replace(`/acceso-denegado?permission=${permission}`)}},[pathname]);
 if(allowed===null||!allowed)return <main className="flex min-h-screen items-center justify-center bg-black text-white">Verificando permisos...</main>;
 // Encabezado fijo: solo Volver a la izquierda; el título (negocio, pantalla y descripción) va pegado
 // a la derecha junto al tema, la hora y el logo. En celular el ☰ Menú flota arriba a la derecha,
 // por eso el encabezado deja espacio (pr-28).
 return <main className="min-h-screen bg-black text-white"><InventoryOrderProcessor/><Sidebar/><section className="bpos-main overflow-x-hidden"><header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-800 bg-black/90 px-3 py-3 pr-28 backdrop-blur sm:gap-4 sm:px-6 lg:pr-6"><BackButton/><div className="flex min-w-0 items-center gap-3 sm:gap-5"><div className="min-w-0 text-right"><p className="truncate text-sm font-bold text-orange-500 sm:text-base">{brand}</p><h2 className="mt-0.5 text-xl font-black leading-tight sm:text-3xl">{title}</h2><p className="mt-1 hidden text-sm text-zinc-400 sm:block">{subtitle}</p></div><TopCorner/></div></header><div className="p-3 sm:p-6">{children}</div></section></main>;
}
