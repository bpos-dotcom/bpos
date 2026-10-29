"use client";

import type { Ingredient } from "@/data/inventory";
import { adjustInventory, getInventory } from "@/lib/inventory";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { upsertOperationsAlert } from "@/lib/notifications/operationsCenter";

export type Supplier = { id:string; name:string; phone?:string; whatsapp?:string; rfc?:string; notes?:string; active:boolean; createdAt:string; };
export type PurchaseItem = { id:string; ticketName?:string; ingredientId:number; ingredientName:string; purchasedQuantity:number; inventoryQuantity:number; unit:Ingredient["unit"]; lineTotal:number; receivedQuantity?:number; };
export type Purchase = { id:string; folio:string; createdAt:string; supplier:string; invoice?:string; paymentMethod?:string; subtotal:number; tax:number; total:number; items:PurchaseItem[]; note?:string; source:"manual"|"ocr"|"shopping-list"; ocrText?:string; imageName?:string; status:"confirmed"|"cancelled"; cancelledAt?:string; cancelledBy?:string; cancellationReason?:string; createdBy?:string; };
export type IngredientCostRecord = { id:string; ingredientId:number; ingredientName:string; supplier:string; purchaseId:string; purchasedAt:string; inventoryQuantity:number; total:number; unitCost:number; };

const PURCHASES_KEY="bpos_purchases";
const SUPPLIERS_KEY="bpos_suppliers";
const COSTS_KEY="bpos_ingredient_cost_history";
const SEQ_KEY="bpos_purchase_sequence";
const ALIASES_KEY="bpos_purchase_aliases";
const EVENT="bpos:purchases-updated";
export const PURCHASES_EVENT = EVENT;

function read<T>(key:string,fallback:T):T { if(typeof window==="undefined") return fallback; try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; } catch{return fallback;} }
function write(key:string,value:unknown){ localStorage.setItem(key,JSON.stringify(value)); window.dispatchEvent(new Event(EVENT)); }
function norm(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");}
function nextFolio(){ const n=Number(localStorage.getItem(SEQ_KEY)||"0")+1; localStorage.setItem(SEQ_KEY,String(n)); return `C-${String(n).padStart(6,"0")}`; }

export function getSuppliers():Supplier[]{return read(SUPPLIERS_KEY,[]);}
export function saveSupplier(input:Omit<Supplier,"id"|"createdAt"|"active"> & Partial<Pick<Supplier,"id"|"active">>){ const items=getSuppliers(); const existing=input.id?items.find(x=>x.id===input.id):items.find(x=>norm(x.name)===norm(input.name)); const item:Supplier={id:existing?.id||`supplier-${Date.now()}`,createdAt:existing?.createdAt||new Date().toISOString(),active:input.active??existing?.active??true,...input}; const next=existing?items.map(x=>x.id===existing.id?item:x):[...items,item]; write(SUPPLIERS_KEY,next); return item; }

export function getPurchases():Purchase[]{return read(PURCHASES_KEY,[]);}
export function getIngredientCostHistory():IngredientCostRecord[]{return read(COSTS_KEY,[]);}
export function getLatestIngredientCost(ingredientId:number){return getIngredientCostHistory().filter(x=>x.ingredientId===ingredientId).sort((a,b)=>+new Date(b.purchasedAt)-+new Date(a.purchasedAt))[0];}

export function registerPurchase(input:Omit<Purchase,"id"|"folio"|"createdAt"|"status"|"createdBy">):Purchase {
 if(typeof window==="undefined") throw new Error("Compras solo está disponible en navegador.");
 if(!input.supplier.trim()) throw new Error("Captura el proveedor.");
 if(!input.items.length) throw new Error("Agrega al menos un producto.");
 const user=getCurrentUser(); const now=new Date().toISOString();
 const purchase:Purchase={...input,id:`purchase-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,folio:nextFolio(),createdAt:now,status:"confirmed",createdBy:user.name};
 const costHistory=getIngredientCostHistory();
 for(const item of purchase.items){
   if(!Number.isFinite(item.inventoryQuantity)||item.inventoryQuantity<=0) throw new Error(`Cantidad inválida: ${item.ingredientName}`);
   adjustInventory({ingredientId:item.ingredientId,quantity:item.inventoryQuantity,adjustmentType:"Ajuste positivo",reason:`${purchase.folio} · ${purchase.supplier}${purchase.invoice?` · Ticket ${purchase.invoice}`:""}`});
   if(item.lineTotal>0){
     const previous=getLatestIngredientCost(item.ingredientId); const unitCost=item.lineTotal/item.inventoryQuantity;
     costHistory.push({id:`cost-${Date.now()}-${item.id}`,ingredientId:item.ingredientId,ingredientName:item.ingredientName,supplier:purchase.supplier,purchaseId:purchase.id,purchasedAt:now,inventoryQuantity:item.inventoryQuantity,total:item.lineTotal,unitCost});
     if(previous?.unitCost && unitCost>previous.unitCost*1.1){ const pct=((unitCost/previous.unitCost)-1)*100; upsertOperationsAlert({id:`purchase-cost:${purchase.id}:${item.ingredientId}`,priority:"warning",title:"Aumento de costo",message:`${item.ingredientName} aumentó ${pct.toFixed(1)}% (${previous.unitCost.toFixed(2)} → ${unitCost.toFixed(2)} por ${item.unit}).`,source:"Compras",moduleHref:"/compras",metadata:{purchaseId:purchase.id,ingredientId:item.ingredientId,previousUnitCost:previous.unitCost,unitCost}}); }
   }
 }
 write(COSTS_KEY,costHistory); write(PURCHASES_KEY,[...getPurchases(),purchase]);
 addAuditEvent({category:"Compras",action:"purchase.created",description:`${purchase.folio} registrada con ${purchase.supplier} por $${purchase.total.toFixed(2)}`,userId:String(user.id),userName:user.name,entityId:purchase.id,metadata:{folio:purchase.folio,total:purchase.total,source:purchase.source,items:purchase.items.length}});
 return purchase;
}

export function cancelPurchase(id:string,reason:string){ if(!reason.trim()) throw new Error("El motivo de cancelación es obligatorio."); const purchases=getPurchases(); const purchase=purchases.find(x=>x.id===id); if(!purchase||purchase.status==="cancelled") throw new Error("Compra no disponible para cancelar."); const user=getCurrentUser(); purchase.items.forEach(item=>adjustInventory({ingredientId:item.ingredientId,quantity:item.inventoryQuantity,adjustmentType:"Ajuste negativo",reason:`Cancelación ${purchase.folio} · ${reason}`})); const next=purchases.map(x=>x.id===id?{...x,status:"cancelled" as const,cancelledAt:new Date().toISOString(),cancelledBy:user.name,cancellationReason:reason}:x); write(PURCHASES_KEY,next); addAuditEvent({category:"Compras",action:"purchase.cancelled",description:`${purchase.folio} cancelada: ${reason}`,userId:String(user.id),userName:user.name,entityId:id}); }

// ------------------------------------------------------------------
// Equivalencias: cómo viene escrito un artículo en el ticket del
// proveedor y cuánto agrega al inventario una presentación.
// Ej.: "PAPA 7X7 CAJA" (Costco) → Papas → 16320 g
// ------------------------------------------------------------------
export type PurchaseAlias = { id:string; ticketName:string; supplier?:string; ingredientId:number; ingredientName:string; quantity:number; unit:Ingredient["unit"]; createdAt:string; };

export function getPurchaseAliases():PurchaseAlias[]{return read(ALIASES_KEY,[]);}

export function addPurchaseAlias(input:Omit<PurchaseAlias,"id"|"createdAt">):PurchaseAlias{
 if(!input.ticketName.trim()) throw new Error("Escribe el nombre como aparece en el ticket.");
 if(!(input.quantity>0)) throw new Error("La cantidad por presentación debe ser mayor a cero.");
 const all=getPurchaseAliases();
 const existing=all.find(a=>norm(a.ticketName)===norm(input.ticketName)&&norm(a.supplier||"")===norm(input.supplier||""));
 const item:PurchaseAlias={...input,ticketName:input.ticketName.trim(),supplier:input.supplier?.trim()||undefined,id:existing?.id||`palias-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,createdAt:existing?.createdAt||new Date().toISOString()};
 write(ALIASES_KEY,existing?all.map(a=>a.id===existing.id?item:a):[...all,item]);
 return item;
}

export function deletePurchaseAlias(id:string){write(ALIASES_KEY,getPurchaseAliases().filter(a=>a.id!==id));}

/** Busca la equivalencia de una línea del ticket (prioriza la del mismo proveedor) */
export function findPurchaseAlias(ticketText:string,supplier?:string):PurchaseAlias|undefined{
 const text=norm(ticketText); if(!text) return undefined;
 const all=getPurchaseAliases();
 const matches=all.filter(a=>{const name=norm(a.ticketName);return name===text||text.includes(name);});
 if(!matches.length) return undefined;
 const sameSupplier=matches.filter(a=>a.supplier&&supplier&&norm(a.supplier)===norm(supplier));
 const pool=sameSupplier.length?sameSupplier:matches.filter(a=>!a.supplier||!supplier||norm(a.supplier)===norm(supplier));
 return (pool.length?pool:matches).sort((a,b)=>b.ticketName.length-a.ticketName.length)[0];
}

// ------------------------------------------------------------------
// Sugerencias de compra: lo que está en o debajo del mínimo
// ------------------------------------------------------------------
export type PurchaseSuggestion = { ingredientId:number; ingredientName:string; unit:Ingredient["unit"]; stock:number; minimum:number; suggestedQuantity:number; lastUnitCost?:number; estimatedCost?:number; lastSupplier?:string; };

export function getPurchaseSuggestions():PurchaseSuggestion[]{
 return getInventory()
  .filter(i=>Number(i.minimum)>0&&Number(i.stock)<=Number(i.minimum))
  .map(i=>{
   const last=getLatestIngredientCost(i.id);
   // Reponer hasta el doble del mínimo
   const raw=Math.max(Number(i.minimum)*2-Number(i.stock),Number(i.minimum));
   const suggestedQuantity=i.unit==="pza"?Math.ceil(raw):Math.ceil(raw/10)*10;
   return {ingredientId:i.id,ingredientName:i.name,unit:i.unit,stock:Number(i.stock),minimum:Number(i.minimum),suggestedQuantity,lastUnitCost:last?.unitCost,estimatedCost:last?.unitCost?last.unitCost*suggestedQuantity:undefined,lastSupplier:last?.supplier};
  })
  .sort((a,b)=>(a.stock/a.minimum)-(b.stock/b.minimum));
}

export function buildSupplierOrderMessage(supplierName:string,lines:{name:string;quantity:number;unit:string}[],businessName="B-POS"){
 const items=lines.map(l=>`• ${l.name}: ${Number(l.quantity.toFixed(2))} ${l.unit}`).join("\n");
 return `Hola${supplierName?` ${supplierName}`:""}, soy de ${businessName}. Quisiera hacer el siguiente pedido:\n\n${items}\n\n¿Me confirma disponibilidad y total? Gracias.`;
}

export function whatsappUrl(phone:string,message:string){
 let digits=phone.replace(/\D/g,""); if(digits.length===10) digits=`52${digits}`;
 return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

