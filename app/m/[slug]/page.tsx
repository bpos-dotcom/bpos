"use client";
/**
 * Menú digital público: bpos.com.mx/m/<liga>(?mesa=4). La pantalla vive en
 * components/menu/PublicMenu.tsx (también la usa el kiosco, /kiosco).
 */
import { use } from "react";
import { PublicMenu } from "@/components/menu/PublicMenu";

export default function PublicMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <PublicMenu slug={slug} />;
}
