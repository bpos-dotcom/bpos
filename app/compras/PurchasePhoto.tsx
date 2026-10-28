"use client";
import { useEffect, useRef, useState } from "react";

type Props={onTextDetected?:(text:string,imageName?:string)=>void};
export default function PurchasePhoto({onTextDetected}:Props){
 const inputRef=useRef<HTMLInputElement>(null); const [preview,setPreview]=useState<string|null>(null); const [file,setFile]=useState<File|null>(null); const [ticketText,setTicketText]=useState(""); const [busy,setBusy]=useState(false); const [progress,setProgress]=useState(0);
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview)},[preview]);
 function handleFile(next:File){if(preview)URL.revokeObjectURL(preview);setFile(next);setPreview(URL.createObjectURL(next));setTicketText("");setProgress(0);}
 async function runOcr(){if(!file){alert("Selecciona o toma una foto del ticket.");return;} setBusy(true);setProgress(0); try{ const Tesseract=await import("tesseract.js"); const result=await Tesseract.recognize(file,"spa+eng",{logger:(m)=>{if(typeof m.progress==="number")setProgress(Math.round(m.progress*100));}}); setTicketText(result.data.text.trim()); }catch(e){console.error(e);alert("No se pudo ejecutar OCR. Verifica que npm install haya instalado tesseract.js.");}finally{setBusy(false);} }
 function process(){if(!ticketText.trim()){alert("No hay texto para procesar.");return;} onTextDetected?.(ticketText,file?.name);}
 return <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6"><h2 className="text-xl font-black text-orange-500">📸 Ticket + OCR Tesseract</h2><p className="mt-2 text-sm text-zinc-400">Toma una foto o selecciona una imagen. Tesseract lee el ticket localmente; revisa el texto antes de confirmar.</p>
 <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f)}}/>
 <button type="button" onClick={()=>inputRef.current?.click()} className="mt-5 flex h-64 w-full items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed border-zinc-700 bg-black hover:border-orange-500">{preview?<img src={preview} alt="Ticket" className="h-full w-full object-contain"/>:<span className="text-center"><span className="block text-6xl">📷</span><span className="mt-3 block font-black">Tomar / seleccionar foto</span></span>}</button>
 <button type="button" disabled={!file||busy} onClick={runOcr} className="mt-4 w-full rounded-2xl border border-orange-500 px-4 py-3 font-black text-orange-400 disabled:opacity-40">{busy?`Leyendo ticket… ${progress}%`:"Leer ticket con Tesseract OCR"}</button>
 <textarea value={ticketText} onChange={e=>setTicketText(e.target.value)} placeholder="El texto detectado aparecerá aquí. También puedes corregirlo manualmente." className="mt-4 min-h-48 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3"/>
 <button type="button" onClick={process} className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black">Interpretar compra</button></section>;
}
