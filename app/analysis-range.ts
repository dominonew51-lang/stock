export const analysisRanges = ["1月", "6月", "1年", "3年", "5年", "全部", "自定义"] as const;
export type AnalysisRange = typeof analysisRanges[number];
export function filterAnalysisDates<T extends { date:string }>(records:T[], range:string, today:string, start="", end=""):T[] {
  if (range === "自定义") {
    if (start && end && start > end) return [];
    return records.filter(row=>(!start || row.date>=start) && (!end || row.date<=end));
  }
  const months:Record<string,number> = {"1月":1,"6月":6,"1年":12,"3年":36,"5年":60};
  if (!months[range]) return records;
  const [year, month, day] = today.split("-").map(Number);
  const cutoff = new Date(Date.UTC(year, month-1-months[range], 1));
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(),cutoff.getUTCMonth()+1,0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day,lastDay));
  const key=cutoff.toISOString().slice(0,10);
  return records.filter(row=>row.date>=key && row.date<=today);
}
