import { PrintJob } from "@/lib/bridge/printManager";

const LOCAL_SERVICE_URL = "http://localhost:4850";

export async function checkLocalService() {
  try {
    const response = await fetch(LOCAL_SERVICE_URL, {
      method: "GET",
    });

    if (!response.ok) return false;

    const data = await response.json();

    return data?.status === "running";
  } catch {
    return false;
  }
}

export async function sendJobToLocalService(job: PrintJob) {
  const response = await fetch(`${LOCAL_SERVICE_URL}/print`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(job),
  });

  if (!response.ok) {
    throw new Error("No se pudo enviar la comanda al servicio local.");
  }

  return response.json();
}