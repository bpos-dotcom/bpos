"use client";

import { findPurchaseAlias } from "@/lib/purchases";

export type TicketBlockRole =
  | "ignore" | "product" | "multiplier" | "quantity" | "price_total" | "price_unit"
  | "presentation" | "supplier" | "date" | "invoice" | "subtotal" | "tax" | "total";

export type TicketTrainingBlock = {
  id: string;
  text: string;
  role: TicketBlockRole;
  ingredientId?: number;
  ingredientName?: string;
  linkedProductId?: string;
  numericValue?: number;
  inventoryPerUnit?: number;
};

export type TicketTemplateRule = Omit<TicketTrainingBlock, "id" | "numericValue"> & {
  matchText: string;
};

export type PurchaseTicketTemplate = {
  id: string;
  name: string;
  headerMatch: string;
  supplier?: string;
  createdAt: string;
  updatedAt: string;
  rules: TicketTemplateRule[];
};

const KEY = "bpos_purchase_ticket_templates_v1";
const EVENT = "bpos:purchase-ticket-templates-updated";

const norm = (v:string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.$%/# -]/g," ").replace(/\s+/g," ").trim();
export const parseNumeric = (v:string) => {
  const matches=v.replace(/,/g,"").match(/-?\d+(?:\.\d+)?/g);
  return matches?.length ? Number(matches[matches.length-1]) : 0;
};

export function textToTicketBlocks(text:string):TicketTrainingBlock[]{
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((text,index)=>({
    id:`block-${index}-${Math.random().toString(36).slice(2,7)}`, text, role:"ignore", numericValue:parseNumeric(text)
  }));
}

export function getPurchaseTicketTemplates():PurchaseTicketTemplate[]{
  if(typeof window==="undefined") return [];
  try{return JSON.parse(localStorage.getItem(KEY)||"[]");}catch{return [];}
}
export function savePurchaseTicketTemplate(input:Omit<PurchaseTicketTemplate,"id"|"createdAt"|"updatedAt"> & {id?:string}){
  const all=getPurchaseTicketTemplates(); const now=new Date().toISOString(); const old=input.id?all.find(x=>x.id===input.id):undefined;
  const item:PurchaseTicketTemplate={...input,id:old?.id||`ticket-template-${Date.now()}`,createdAt:old?.createdAt||now,updatedAt:now};
  localStorage.setItem(KEY,JSON.stringify(old?all.map(x=>x.id===old.id?item:x):[...all,item]));
  window.dispatchEvent(new Event(EVENT)); return item;
}
export function deletePurchaseTicketTemplate(id:string){localStorage.setItem(KEY,JSON.stringify(getPurchaseTicketTemplates().filter(x=>x.id!==id)));window.dispatchEvent(new Event(EVENT));}

function scoreRule(rule:TicketTemplateRule, text:string){
  const a=norm(rule.matchText), b=norm(text); if(!a||!b)return 0; if(a===b)return 100; if(b.includes(a)||a.includes(b))return 80;
  const words=a.split(" ").filter(w=>w.length>2); if(!words.length)return 0; const hits=words.filter(w=>b.includes(w)).length; return Math.round((hits/words.length)*70);
}
export function detectPurchaseTicketTemplate(text:string){
  const n=norm(text); return getPurchaseTicketTemplates().map(t=>({template:t,score:n.includes(norm(t.headerMatch))?100:0})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)[0]?.template;
}
export function applyPurchaseTicketTemplate(blocks:TicketTrainingBlock[],template:PurchaseTicketTemplate){
  const productRuleToBlock=new Map<number,string>();
  const next=blocks.map(block=>{
    let best=-1,bestScore=0; template.rules.forEach((r,i)=>{const s=scoreRule(r,block.text);if(s>bestScore){best=i;bestScore=s;}});
    if(best<0||bestScore<45)return block; const r=template.rules[best];
    const mapped={...block,role:r.role,ingredientId:r.ingredientId,ingredientName:r.ingredientName,numericValue:parseNumeric(block.text)};
    if(r.role==="product")productRuleToBlock.set(best,block.id); return mapped;
  });
  // Recreate links by the saved product rule's match text.
  return next.map(block=>{
    const matched=template.rules.map((r,i)=>({r,i,s:scoreRule(r,block.text)})).sort((a,b)=>b.s-a.s)[0];
    if(!matched||matched.s<45||!matched.r.linkedProductId)return block;
    const sourceProductRule=template.rules.findIndex(r=>r.role==="product" && r.matchText===matched.r.linkedProductId);
    return {...block,linkedProductId:productRuleToBlock.get(sourceProductRule)};
  });
}

export function blocksToTemplateRules(blocks:TicketTrainingBlock[]):TicketTemplateRule[]{
  return blocks.map(b=>({
    text:b.text, matchText:b.text, role:b.role, ingredientId:b.ingredientId, ingredientName:b.ingredientName, inventoryPerUnit:b.inventoryPerUnit,
    linkedProductId:b.linkedProductId ? (blocks.find(x=>x.id===b.linkedProductId)?.text || undefined) : undefined
  }));
}
export const PURCHASE_TEMPLATES_EVENT=EVENT;

// ------------------------------------------------------------------
// Del ticket revisado a una compra lista para confirmar
// ------------------------------------------------------------------

export type PurchaseDraftLine = {
  ingredientId: number;
  ticketName: string;
  presentations: number;
  inventoryQuantity: number;
  lineTotal: number;
};

export type PurchaseDraft = {
  supplier?: string;
  invoice?: string;
  lines: PurchaseDraftLine[];
};

const NUMERIC_ROLES: TicketBlockRole[] = ["multiplier", "quantity", "price_total", "price_unit", "presentation"];

/** Lee "2 X PAPA 7X7 CAJA  $640.00" → multiplicador 2 y precio 640 */
export function parseInlineLine(text: string) {
  const clean = text.replace(/,/g, "");
  const lead = clean.match(/^\s*(\d+(?:\.\d+)?)\s*(?:x|pz|pzas?|u|und)?\s+/i);
  const prices = clean.match(/\$?\s*(\d+\.\d{2})\b/g);
  const price = prices?.length ? Number(prices[prices.length - 1].replace(/[^\d.]/g, "")) : 0;
  return { multiplier: lead ? Number(lead[1]) : 0, price };
}

/** Marca como producto las líneas que ya tienen equivalencia guardada */
export function applyPurchaseAliases(blocks: TicketTrainingBlock[], supplier?: string): TicketTrainingBlock[] {
  return blocks.map((block) => {
    if (block.role !== "ignore") return block;
    const alias = findPurchaseAlias(block.text, supplier);
    if (!alias) return block;
    return {
      ...block,
      role: "product",
      ingredientId: alias.ingredientId,
      ingredientName: alias.ingredientName,
      inventoryPerUnit: alias.quantity,
    };
  });
}

export function blocksToPurchaseDraft(blocks: TicketTrainingBlock[]): PurchaseDraft {
  const supplierBlock = blocks.find((b) => b.role === "supplier");
  const invoiceBlock = blocks.find((b) => b.role === "invoice");
  const productIndexes = blocks.map((b, i) => (b.role === "product" ? i : -1)).filter((i) => i >= 0);

  const lines: PurchaseDraftLine[] = [];

  productIndexes.forEach((index, n) => {
    const product = blocks[index];
    if (!product.ingredientId) return;

    // Valores vinculados a mano; si no hay, los bloques que siguen hasta el siguiente producto
    let related = blocks.filter((b) => b.linkedProductId === product.id && NUMERIC_ROLES.includes(b.role));
    if (related.length === 0) {
      const end = productIndexes[n + 1] ?? blocks.length;
      related = blocks.slice(index + 1, end).filter((b) => !b.linkedProductId && NUMERIC_ROLES.includes(b.role));
    }
    const value = (role: TicketBlockRole) => related.find((b) => b.role === role)?.numericValue || 0;

    const inline = parseInlineLine(product.text);
    const presentations = value("multiplier") || value("presentation") || inline.multiplier || 1;
    const quantity = value("quantity");
    const inventoryQuantity =
      product.inventoryPerUnit && product.inventoryPerUnit > 0
        ? product.inventoryPerUnit * presentations
        : quantity || 0;
    const lineTotal = value("price_total") || (value("price_unit") ? value("price_unit") * presentations : 0) || inline.price;

    lines.push({
      ingredientId: product.ingredientId,
      ticketName: product.text,
      presentations,
      inventoryQuantity: Math.round(inventoryQuantity * 1000) / 1000,
      lineTotal: Math.round(lineTotal * 100) / 100,
    });
  });

  return {
    supplier: supplierBlock?.text.trim() || undefined,
    invoice: invoiceBlock ? invoiceBlock.text.replace(/^[^\d]*/, "").trim() || invoiceBlock.text.trim() : undefined,
    lines,
  };
}

/** "2 X PAPA 7X7 CAJA $640.00" → "PAPA 7X7 CAJA" (nombre para recordar la equivalencia) */
export function ticketProductName(text: string) {
  return text
    .replace(/\$?\s*\d[\d,]*\.\d{2}\s*$/g, "")
    .replace(/^\s*\d+(?:\.\d+)?\s*(?:x|pz|pzas?|u|und)?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
