"use client";

export type PaymentMethodConfig = { id:string; name:string; enabled:boolean; affectsCash:boolean; channel?:"normal"|"platform" };
const KEY="bpos_payment_methods";
export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
 {id:"cash",name:"Efectivo",enabled:true,affectsCash:true,channel:"normal"},
 {id:"card",name:"Tarjeta",enabled:true,affectsCash:false,channel:"normal"},
 {id:"transfer",name:"Transferencia",enabled:true,affectsCash:false,channel:"normal"},
 {id:"mixed",name:"Mixto",enabled:true,affectsCash:true,channel:"normal"},
 {id:"didi",name:"DiDi Food",enabled:true,affectsCash:false,channel:"platform"},
 {id:"uber",name:"Uber Eats",enabled:true,affectsCash:false,channel:"platform"},
 {id:"rappi",name:"Rappi",enabled:false,affectsCash:false,channel:"platform"},
];
export function getPaymentMethods(){ if(typeof window==="undefined") return DEFAULT_PAYMENT_METHODS; try{ const raw=localStorage.getItem(KEY); if(!raw){localStorage.setItem(KEY,JSON.stringify(DEFAULT_PAYMENT_METHODS));return DEFAULT_PAYMENT_METHODS;} return JSON.parse(raw) as PaymentMethodConfig[];}catch{return DEFAULT_PAYMENT_METHODS;} }
export function savePaymentMethods(items:PaymentMethodConfig[]){localStorage.setItem(KEY,JSON.stringify(items));window.dispatchEvent(new Event("bpos:payment-methods-updated"));}
export function getEnabledPaymentMethods(){return getPaymentMethods().filter(x=>x.enabled);}
