"use client";
import type { UserRole, CurrentUser } from "@/lib/auth";
import { addAuditEvent } from "@/lib/audit";
import { findActiveAdminByPin } from "@/lib/users";

export type PermissionKey =
 | "dashboard.view" | "pos.view" | "pos.discount" | "pos.cancel" | "pos.correct" | "pos.reprint"
 | "cash.view" | "cash.open" | "cash.movement" | "cash.close" | "cash.authorize_difference" | "cash.history"
 | "kds.view" | "printing.view" | "printing.reprint"
 | "inventory.view" | "inventory.adjust" | "inventory.costs"
 | "purchases.view" | "purchases.create" | "purchases.cancel" | "purchases.aliases" | "purchases.suppliers" | "bridge.view" | "bridge.aliases"
 | "reports.view" | "settings.view" | "products.manage" | "ingredients.manage" | "recipes.manage" | "prices.manage"
 | "users.manage" | "audit.view" | "owner.view";

export const PERMISSIONS:{key:PermissionKey;label:string;group:string}[]=[
 {key:"dashboard.view",label:"Ver Dashboard",group:"Páginas"},{key:"pos.view",label:"Abrir POS",group:"Páginas"},{key:"cash.view",label:"Ver Caja",group:"Páginas"},{key:"kds.view",label:"Ver Cocina KDS",group:"Páginas"},{key:"printing.view",label:"Ver Impresiones",group:"Páginas"},{key:"inventory.view",label:"Ver Inventario",group:"Páginas"},{key:"purchases.view",label:"Ver Compras",group:"Páginas"},{key:"purchases.create",label:"Registrar compras",group:"Compras"},{key:"purchases.cancel",label:"Cancelar compras",group:"Compras"},{key:"purchases.aliases",label:"Administrar equivalencias de compra",group:"Compras"},{key:"purchases.suppliers",label:"Administrar proveedores",group:"Compras"},{key:"bridge.view",label:"Ver Bridge",group:"Páginas"},{key:"reports.view",label:"Ver Reportes",group:"Páginas"},{key:"settings.view",label:"Ver Configuración",group:"Páginas"},{key:"audit.view",label:"Ver Bitácora",group:"Páginas"},{key:"owner.view",label:"Ver App del dueño",group:"Páginas"},
 {key:"pos.discount",label:"Aplicar descuentos",group:"POS"},{key:"pos.cancel",label:"Cancelar o borrar ventas",group:"POS"},{key:"pos.correct",label:"Corregir pedidos",group:"POS"},{key:"pos.reprint",label:"Reimprimir tickets/comandas",group:"POS"},
 {key:"cash.open",label:"Abrir caja",group:"Caja"},{key:"cash.movement",label:"Registrar movimientos",group:"Caja"},{key:"cash.close",label:"Cerrar caja",group:"Caja"},{key:"cash.authorize_difference",label:"Autorizar diferencias",group:"Caja"},{key:"cash.history",label:"Ver historial de cortes",group:"Caja"},
 {key:"printing.reprint",label:"Reimprimir desde Impresiones",group:"Impresiones"},{key:"inventory.adjust",label:"Ajustar inventario",group:"Inventario"},{key:"inventory.costs",label:"Ver costos",group:"Inventario"},
 {key:"bridge.aliases",label:"Administrar equivalencias",group:"Administración"},{key:"products.manage",label:"Administrar productos",group:"Administración"},{key:"ingredients.manage",label:"Administrar ingredientes",group:"Administración"},{key:"recipes.manage",label:"Administrar recetas",group:"Administración"},{key:"prices.manage",label:"Modificar precios",group:"Administración"},{key:"users.manage",label:"Administrar usuarios y permisos",group:"Administración"},
];
const KEY="bpos_user_permissions";
const all=PERMISSIONS.map(x=>x.key);
const ROLE_DEFAULTS:Record<UserRole,PermissionKey[]>={
 Admin:all,
 Gerente:all.filter(x=>!["users.manage","prices.manage"].includes(x)),
 Cajero:["dashboard.view","pos.view","pos.reprint","cash.view","cash.history","kds.view"],
 Cocina:["kds.view","printing.view"],
 Inventario:["dashboard.view","inventory.view","inventory.adjust","purchases.view","purchases.create","purchases.aliases","purchases.suppliers"],
 Consulta:["dashboard.view","reports.view"],
};
export function getRoleDefaults(role:UserRole){return [...ROLE_DEFAULTS[role]];}
export function getUserPermissions(userId:number,role:UserRole):PermissionKey[]{if(typeof window==="undefined")return ROLE_DEFAULTS[role];try{const saved=JSON.parse(localStorage.getItem(KEY)||"{}");return Array.isArray(saved[userId])?saved[userId]:ROLE_DEFAULTS[role];}catch{return ROLE_DEFAULTS[role];}}
export function saveUserPermissions(userId:number,items:PermissionKey[]){const saved=JSON.parse(localStorage.getItem(KEY)||"{}");saved[userId]=Array.from(new Set(items));localStorage.setItem(KEY,JSON.stringify(saved));window.dispatchEvent(new Event("bpos:permissions-updated"));}
export function resetUserPermissions(userId:number){const saved=JSON.parse(localStorage.getItem(KEY)||"{}");delete saved[userId];localStorage.setItem(KEY,JSON.stringify(saved));window.dispatchEvent(new Event("bpos:permissions-updated"));}
// El Admin siempre puede todo: así los permisos nuevos (ej. owner.view) no le quedan bloqueados por una lista guardada antes.
export function hasPermission(user:Pick<CurrentUser,"id"|"role">|null|undefined,key:PermissionKey){return !!user&&user.id>0&&(user.role==="Admin"||getUserPermissions(user.id,user.role).includes(key));}
// El PIN se revisa contra su hash (lib/pin-hash.ts): por eso esperan (async)
export async function authorizeWithAdminPin(action:string, requestedBy?:CurrentUser|null):Promise<boolean>{
 const pin=window.prompt(`Se requiere autorización de administrador para: ${action}\n\nIngresa PIN de administrador:`);
 if(!pin)return false;
 const admin=await findActiveAdminByPin(pin);
 if(!admin){addAuditEvent({category:"Seguridad",action:"authorization.denied",description:`Autorización rechazada para ${action}`,userId:requestedBy?String(requestedBy.id):undefined,userName:requestedBy?.name,metadata:{action}});alert("PIN de administrador incorrecto.");return false;}
 addAuditEvent({category:"Seguridad",action:"authorization.approved",description:`${admin.name} autorizó: ${action}`,userId:String(admin.id),userName:admin.name,metadata:{action,requestedBy:requestedBy?.name}});
 return true;
}
export async function requirePermissionOrAdmin(user:CurrentUser|null|undefined,key:PermissionKey,action:string):Promise<boolean>{if(hasPermission(user,key))return true;return authorizeWithAdminPin(action,user);}

export const ROUTE_PERMISSIONS:{prefix:string;permission:PermissionKey}[]=[
 {prefix:"/pos",permission:"pos.view"},{prefix:"/pedidos-en-linea",permission:"pos.view"},{prefix:"/caja/historial",permission:"cash.history"},{prefix:"/caja",permission:"cash.view"},{prefix:"/cocina",permission:"kds.view"},{prefix:"/impresiones",permission:"printing.view"},{prefix:"/inventario",permission:"inventory.view"},{prefix:"/compras",permission:"purchases.view"},{prefix:"/bridge",permission:"bridge.view"},{prefix:"/reportes",permission:"reports.view"},{prefix:"/dueno",permission:"owner.view"},{prefix:"/configuracion/auditoria",permission:"audit.view"},{prefix:"/configuracion/usuarios",permission:"users.manage"},{prefix:"/configuracion",permission:"settings.view"},{prefix:"/",permission:"dashboard.view"},
];
export function permissionForPath(pathname:string){return ROUTE_PERMISSIONS.find(x=>x.prefix==="/"?pathname==="/":pathname.startsWith(x.prefix))?.permission;}
