"use client";
import { useMemo, useState } from "react";
import { getInventory } from "@/lib/inventory";
import { applyPurchaseAliases, applyPurchaseTicketTemplate, blocksToTemplateRules, deletePurchaseTicketTemplate, detectPurchaseTicketTemplate, getPurchaseTicketTemplates, savePurchaseTicketTemplate, textToTicketBlocks, type PurchaseTicketTemplate, type TicketBlockRole, type TicketTrainingBlock } from "@/lib/purchase-ticket-training";

const ROLES:{value:TicketBlockRole;label:string}[]=[
 {value:"ignore",label:"🚫 Ignorar"},{value:"product",label:"📦 Producto / ingrediente"},{value:"multiplier",label:"✖ Multiplicador"},{value:"quantity",label:"⚖ Cantidad"},{value:"price_total",label:"💰 Precio total"},{value:"price_unit",label:"🏷 Precio unitario"},{value:"presentation",label:"📦 Presentación"},{value:"supplier",label:"🏪 Proveedor"},{value:"date",label:"📅 Fecha"},{value:"invoice",label:"🧾 No. ticket"},{value:"subtotal",label:"Subtotal"},{value:"tax",label:"IVA"},{value:"total",label:"Total"},
];

type Props={text:string; supplier:string; onSupplier:(v:string)=>void; onReady:(blocks:TicketTrainingBlock[],template?:PurchaseTicketTemplate)=>void};
export default function TicketTrainer({text,supplier,onSupplier,onReady}:Props){
 const inventory=useMemo(()=>getInventory(),[]); const initial=useMemo(()=>textToTicketBlocks(text),[text]);
 const autoTemplate=useMemo(()=>detectPurchaseTicketTemplate(text),[text]);
 const [blocks,setBlocks]=useState<TicketTrainingBlock[]>(()=>applyPurchaseAliases(autoTemplate?applyPurchaseTicketTemplate(initial,autoTemplate):initial,supplier||autoTemplate?.supplier));
 const [templateName,setTemplateName]=useState(autoTemplate?.name||""); const [headerMatch,setHeaderMatch]=useState(autoTemplate?.headerMatch||initial[0]?.text||"");
 const [templatesVersion,setTemplatesVersion]=useState(0); const templates=useMemo(()=>getPurchaseTicketTemplates(),[templatesVersion]);
 const products=blocks.filter(b=>b.role==="product");
 function patch(id:string,p:Partial<TicketTrainingBlock>){setBlocks(v=>v.map(b=>b.id===id?{...b,...p}:b));}
 function saveTemplate(){if(!templateName.trim()||!headerMatch.trim()){alert("Escribe nombre de plantilla y texto de encabezado.");return;} const saved=savePurchaseTicketTemplate({id:autoTemplate?.id,name:templateName.trim(),headerMatch:headerMatch.trim(),supplier:supplier.trim()||undefined,rules:blocksToTemplateRules(blocks)});setTemplatesVersion(x=>x+1);alert(`Plantilla “${saved.name}” guardada. Los próximos tickets con ese encabezado se preconfigurarán automáticamente.`);}
 function loadTemplate(t:PurchaseTicketTemplate){setTemplateName(t.name);setHeaderMatch(t.headerMatch);if(t.supplier)onSupplier(t.supplier);setBlocks(applyPurchaseTicketTemplate(initial,t));}
 return <section className="rounded-3xl border border-orange-500/40 bg-zinc-950 p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black text-orange-500">🧠 Entrenar / revisar ticket</h2><p className="mt-1 text-sm text-zinc-400">Tesseract lee todo. Tú decides qué significa cada bloque y B-POS aprende la plantilla.</p></div>{autoTemplate&&<span className="rounded-full bg-green-500/15 px-3 py-2 text-xs font-black text-green-400">✓ Plantilla detectada: {autoTemplate.name}</span>}</div>
  <div className="mt-5 grid gap-3 md:grid-cols-3"><input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Nombre: Ticket PRIM SUPPLIERS" className="rounded-xl border border-zinc-700 bg-black px-3 py-3"/><input value={headerMatch} onChange={e=>setHeaderMatch(e.target.value)} placeholder="Encabezado que identifica este ticket" className="rounded-xl border border-zinc-700 bg-black px-3 py-3"/><button onClick={saveTemplate} className="rounded-xl bg-green-500 px-3 py-3 font-black text-black">Guardar / entrenar plantilla</button></div>
  {templates.length>0&&<div className="mt-3 flex flex-wrap gap-2">{templates.map(t=><span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-black px-2 py-1 text-xs"><button onClick={()=>loadTemplate(t)} className="font-bold">{t.name}</button><button title="Eliminar plantilla" onClick={()=>{if(confirm(`¿Eliminar plantilla ${t.name}?`)){deletePurchaseTicketTemplate(t.id);setTemplatesVersion(x=>x+1)}}} className="px-1 text-red-400">×</button></span>)}</div>}
  <div className="mt-5 space-y-3">{blocks.map((b,i)=><div key={b.id} className={`rounded-2xl border p-4 ${b.role==="ignore"?"border-zinc-800 bg-black/60":"border-orange-500/30 bg-black"}`}>
   <div className="mb-3 flex items-center gap-2"><span className="rounded bg-zinc-800 px-2 py-1 text-xs font-black">Bloque {i+1}</span><input value={b.text} onChange={e=>patch(b.id,{text:e.target.value})} className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-bold"/></div>
   <div className="grid gap-2 md:grid-cols-3"><select value={b.role} onChange={e=>patch(b.id,{role:e.target.value as TicketBlockRole,ingredientId:undefined,ingredientName:undefined,linkedProductId:undefined})} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2">{ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
   {b.role==="product"&&<><select value={b.ingredientId||""} onChange={e=>{const ing=inventory.find(x=>x.id===Number(e.target.value));patch(b.id,{ingredientId:ing?.id,ingredientName:ing?.name})}} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="">Relacionar ingrediente B-POS…</option>{inventory.map(ing=><option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}</select><input type="number" step="any" value={b.inventoryPerUnit||""} onChange={e=>patch(b.id,{inventoryPerUnit:Number(e.target.value)||0})} placeholder="Entrada inventario por 1 unidad (ej. 16320 g)" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"/></>}
   {["multiplier","quantity","price_total","price_unit","presentation"].includes(b.role)&&<select value={b.linkedProductId||""} onChange={e=>patch(b.id,{linkedProductId:e.target.value||undefined})} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"><option value="">Vincular a producto…</option>{products.map(p=><option key={p.id} value={p.id}>{p.text}</option>)}</select>}
   {b.role!=="ignore"&&b.role!=="product"&&<input type="number" step="any" value={b.numericValue||""} onChange={e=>patch(b.id,{numericValue:Number(e.target.value)||0})} placeholder="Valor detectado / corregido" className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2"/>}</div>
  </div>)}</div>
  <button onClick={()=>onReady(blocks,autoTemplate)} className="mt-5 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black">Continuar a confirmar compra →</button>
 </section>;
}
