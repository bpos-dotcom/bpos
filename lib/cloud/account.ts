/**
 * Cuenta de la nube de este dispositivo: cuenta Supabase → negocio → sucursal.
 * (Los empleados siguen entrando con su PIN como siempre; esto es solo
 * para que el dispositivo pertenezca al negocio.)
 */
import { friendlyError, getSupabase, isCloudConfigured } from "@/lib/supabase/client";

const BRANCH_KEY = "bpos_branch_id";

export type CloudBranch = { id: string; name: string };

export type CloudAccount =
  | { status: "local" }
  | { status: "signed-out" }
  | { status: "no-business"; userId: string; email: string }
  | {
      status: "ready";
      userId: string;
      email: string;
      businessId: string;
      businessName: string;
      branchId: string;
      branchName: string;
      branches: CloudBranch[];
    };

export type ReadyAccount = Extract<CloudAccount, { status: "ready" }>;

export async function loadCloudAccount(): Promise<CloudAccount> {
  if (!isCloudConfigured) return { status: "local" };

  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!user) return { status: "signed-out" };

  const { data: memberships, error } = await supabase
    .from("business_members")
    .select("business_id, businesses(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(friendlyError(error));

  const membership = memberships?.[0] as
    | { business_id: string; businesses: { name: string } | { name: string }[] | null }
    | undefined;
  if (!membership) return { status: "no-business", userId: user.id, email: user.email ?? "" };

  const business = Array.isArray(membership.businesses)
    ? membership.businesses[0]
    : membership.businesses;

  const { data: branches, error: branchError } = await supabase
    .from("branches")
    .select("id, name")
    .eq("business_id", membership.business_id)
    .order("created_at", { ascending: true });
  if (branchError) throw new Error(friendlyError(branchError));

  const list = (branches ?? []) as CloudBranch[];
  if (list.length === 0) return { status: "no-business", userId: user.id, email: user.email ?? "" };

  const saved = localStorage.getItem(BRANCH_KEY);
  const branch = list.find((b) => b.id === saved) ?? list[0];

  return {
    status: "ready",
    userId: user.id,
    email: user.email ?? "",
    businessId: membership.business_id,
    businessName: business?.name ?? "Mi negocio",
    branchId: branch.id,
    branchName: branch.name,
    branches: list,
  };
}

export async function signIn(email: string, password: string) {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(friendlyError(error));
}

/** true = la cuenta quedó lista; false = falta confirmar el correo */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(friendlyError(error));
  return Boolean(data.session);
}

export async function signOutDevice() {
  await getSupabase().auth.signOut();
  localStorage.removeItem(BRANCH_KEY);
}

export async function createBusiness(businessName: string, branchName: string) {
  const { error } = await getSupabase().rpc("create_business", {
    p_business_name: businessName,
    p_branch_name: branchName,
  });
  if (error) throw new Error(friendlyError(error));
}

export function selectBranch(branchId: string) {
  localStorage.setItem(BRANCH_KEY, branchId);
}
