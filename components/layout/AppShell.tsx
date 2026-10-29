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
export function AppShell({title,subtitle,children}:{title:string;subtitle:string;children:ReactNode}){
 const pathname=usePathname();const[allowed,setAllowed]=useState<boolean|null>(null);
 // Marca blanca: el nombre del negocio (Configuración → Empresa) · B-POS
 const[brand,setBrand]=useState("B-POS");
 useEffect(()=>{const name=getBusinessSettings().businessName;setBrand(name?`${name} · B-POS`:"B-POS");},[]);
 useEffect(()=>{const user=getSessionUser();if(!user){redirectToLogin();return;}const permission=permissionForPath(pathname);const ok=!permission||hasPermission(user,permission);setAllowed(ok);if(!ok){addAuditEvent({category:"Seguridad",action:"access.denied",description:`${user.name} intentó abrir ${pathname}`,userId:String(user.id),userName:user.name,metadata:{pathname,permission}});window.location.replace(`/acceso-denegado?permission=${permission}`)}},[pathname]);
 if(allowed===null||!allowed)return <main className="flex min-h-screen items-center justify-center bg-black text-white">Verificando permisos...</main>;
 return <main className="min-h-screen bg-black text-white"><InventoryOrderProcessor/><Sidebar/><section className="bpos-main"><header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-zinc-800 bg-black/90 px-6 py-3 backdrop-blur"><div className="min-w-0"><p className="font-bold text-orange-500">{brand}</p><h2 className="mt-1 text-3xl font-black">{title}</h2><p className="mt-1 text-zinc-400">{subtitle}</p></div><TopCorner/></header><div className="p-6">{children}</div></section></main>;
}
