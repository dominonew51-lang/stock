export const eventIndustries = ["太空", "AI", "链"] as const;
export const eventTypes = ["解禁", "重大发射", "重要建设", "会议", "发布会", "法案"] as const;
export type EventIndustry = typeof eventIndustries[number];
export type EventType = typeof eventTypes[number];
export type CalendarEvent = { id:string; title:string; eventType:EventType; industries:EventIndustry[]; symbols:string[]; startAt:string; endAt?:string|null; timezone:string; datePrecision:"date"|"range"|"month"|"unknown"; importance:"关键"|"关注"; status:"scheduled"|"postponed"|"cancelled"; verification:"official"|"manual"; sourceName:string; sourceUrl:string; updatedAt:string; hidden?:boolean };
export const trackedIndustries: Record<EventIndustry,string[]> = { 太空:["SPCX","RKLB"], AI:["TSLA","SPCX"], 链:["COIN","CRCL","ETH","BTC"] };
export function normalizeEventTitle(value:string){ return value.trim().replace(/\s+/g," ").toLowerCase(); }
export function eventDedupKey(event:Pick<CalendarEvent,"title"|"startAt"|"sourceUrl">){ return `${normalizeEventTitle(event.title)}|${event.startAt.slice(0,10)}|${event.sourceUrl}`; }
