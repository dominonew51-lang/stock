const tradedAssetAliases: Record<string, string> = {
  COINBASE: "COIN",
  "COINBASE GLOBAL": "COIN",
  CIRCLE: "CRCL",
  "CIRCLE INTERNET GROUP": "CRCL",
};

export function normalizeLookupSymbol(value: string) {
  const entered = String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  return tradedAssetAliases[entered] ?? entered;
}
