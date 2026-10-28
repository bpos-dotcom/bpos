function detectPlatform(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (
    normalized.includes("didifood") ||
    normalized.includes("didi")
  ) {
    return "didi";
  }

  if (
    normalized.includes("ubereats") ||
    normalized.includes("uber")
  ) {
    return "uber";
  }

  if (normalized.includes("rappi")) {
    return "rappi";
  }

  return "unknown";
}

module.exports = {
  detectPlatform,
};