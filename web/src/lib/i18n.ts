import { createContext, useContext } from "react";

export type Lang = "zh" | "en";
const T = {
  tagline: { zh: "拍一段影片，你的房間就量好了。", en: "Film your room. Get it measured." },
  sub: { zh: "AI 幫你在蝦皮挑家具，確定放得下再買。", en: "An AI shopper picks Shopee furniture that actually fits." },
  openDemo: { zh: "看看示範房間", en: "Open the demo room" },
  scanOwn: { zh: "用 iPhone 掃你的房間", en: "Scan your own room (iPhone)" },
  yourRoom: { zh: "這是你的房間", en: "Here's your room" },
  blocks: { zh: "俯視", en: "Overview" },
  walk: { zh: "走進去", en: "Walk in" },
  viewMode: { zh: "檢視方式", en: "View" },
  viewerLabel: { zh: "房間 3D 檢視。", en: "3D view of your room." },
  keysHint: { zh: "方向鍵或 WASD 移動與轉向。", en: "Arrow keys or WASD to move and turn." },
  dragHint: { zh: "拖曳轉動 · 方向鍵/WASD 移動", en: "Drag to look · arrows or WASD to move" },
  dragHintReal: { zh: "拖曳環顧（從手機拍攝的位置）", en: "Drag to look around (from where the phone stood)" },
  moveControls: { zh: "移動控制", en: "Move controls" },
  turnLeft: { zh: "向左轉", en: "Turn left" },
  turnRight: { zh: "向右轉", en: "Turn right" },
  forward: { zh: "往前走", en: "Walk forward" },
  back: { zh: "往後退", en: "Step back" },
  zoomIn: { zh: "拉近", en: "Zoom in" },
  zoomOut: { zh: "拉遠", en: "Zoom out" },
  chatTab: { zh: "聊天", en: "Chat" },
  listTab: { zh: "清單", en: "List" },
  roomSections: { zh: "房間面板", en: "Room panels" },
  real: { zh: "真實", en: "Real" },
  reset: { zh: "重設視角", en: "Reset view" },
  list: { zh: "購物清單", en: "Shopping list" },
  shop: { zh: "商品", en: "Products" },
  swapFor: { zh: "換掉你的", en: "Swap out your" },
  swapNone: { zh: "目錄裡還沒有可替換的蝦皮商品。", en: "No Shopee products like this in the catalog yet." },
  showAll: { zh: "看全部", en: "Show all" },
  reviews: { zh: "則評價", en: "reviews" },
  bestSeller: { zh: "熱銷", en: "best seller" },
  chatPlaceholder: { zh: "想添購什麼？", en: "What do you need?" },
  send: { zh: "送出", en: "Send" },
  showMe: { zh: "看看效果", en: "Show me" },
  add: { zh: "加入清單", en: "Add to list" },
  added: { zh: "已加入", en: "Added" },
  openShopee: { zh: "到蝦皮購買", en: "Open in Shopee" },
  remove: { zh: "移除", en: "Remove" },
  total: { zh: "總計", en: "Total" },
  empty: { zh: "清單是空的。跟 Roomie 說你需要什麼。", en: "Your list is empty. Tell Roomie what you need." },
  aiPreview: { zh: "AI 生成預覽", en: "AI-generated preview" },
  making: { zh: "正在生成你房間的照片…", en: "Making a photo of your room…" },
  approx: { zh: "約", en: "approx." },
  store: { zh: "商家", en: "store" },
  thinking: { zh: "Roomie 正在找…", en: "Roomie is looking…" },
  busy: { zh: "現在太多人在用，請稍後再試。", en: "Busy right now, please try again later." },
  measuredFrom: { zh: "量測方式", en: "Measured from" },
  fixSize: { zh: "修正尺寸 (cm)", en: "Correct the size (cm)" },
  save: { zh: "儲存", en: "Save" },
  greeting: {
    zh: "嗨，我是 Roomie。我已經量好你的房間了。想添購什麼？可以直接說，或傳一張你喜歡的風格照片給我。",
    en: "Hi, I'm Roomie. I've measured your room. What would you like to add? Just tell me, or send a photo of a style you like.",
  },
  quick1: { zh: "書桌旁放一盞燈", en: "A lamp by my desk" },
  quick2: { zh: "更多收納，3000 以內", en: "More storage under NT$3,000" },
  quick3: { zh: "幫我配一張地毯", en: "Find me a rug" },
  aiChecked: { zh: "AI 檢查", en: "AI-checked" },
  rounds: { zh: "輪", en: "rounds" },
  photoFailed: { zh: "這張照片沒有生成成功。", en: "That photo didn't come out." },
} as const;

export type Key = keyof typeof T;
export const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "zh", setLang: () => {} });
export function useT() {
  const { lang } = useContext(LangContext);
  return (k: Key) => T[k][lang];
}
export const useLang = () => useContext(LangContext);
export const LABEL_ZH: Record<string, string> = {
  bed: "床", desk: "書桌", chair: "椅子", door: "門", window: "窗", wardrobe: "衣櫃", shelf: "層架", cabinet: "櫃子",
  "storage box": "收納箱", table: "桌子", sofa: "沙發", lamp: "燈", bin: "垃圾桶", "mini fridge": "小冰箱", "air conditioner": "冷氣", rug: "地毯", "drawer unit": "抽屜櫃", nightstand: "床頭櫃", "bed frame": "床架", "floor lamp": "落地燈",
};
