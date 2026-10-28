"use client";
import { ReactNode, useEffect, useState } from "react";
import { getSessionUser, redirectToLogin } from "@/lib/auth";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { addAuditEvent } from "@/lib/audit";
export default function RequirePermission({permission,children}:{permission:PermissionKey;children:ReactNode}){
 const[ok,setOk]=useState<boolean|null>(null);
 useEffect(()=>{const user=getSessionUser();if(!user){redirectToLogin();return;}const allowed=hasPermission(user,permission);setOk(allowed);if(!allowed)addAuditEvent({category:"Seguridad",action:"access.denied",description:`Acceso rechazado a ${permission}`,userId:String(user.id),userName:user.name,metadata:{permission}});},[permission]);
 if(ok===null)return <main className="flex min-h-screen items-center justify-center bg-black text-white">Verificando permisos...</main>;
 if(!ok){window.location.replace(`/acceso-denegado?permission=${encodeURIComponent(permission)}`);return null;}
 return <>{children}</>;
}
