// Shapes shared by the website and the API functions. Room coordinates: meters, floor at y=0,
// walls aligned with x/z, room centre at (0, 0). See pipeline/room.py.

export type Part = { name: string; shape: "box" | "cylinder"; size: [number, number, number]; pos: [number, number, number]; color: string };
export type Size = { w: number; d: number; h: number }; // w along the object's own x (yaw axis), d along z, h up

export type RoomObject = {
  id: string; label: string; center: [number, number, number]; yaw: number; size: Size;
  pm_cm: number; source: "measured" | "approx" | "user"; crop?: string; parts?: Part[];
};
export type Opening = { type: "door" | "window"; from: number; to: number; bottom: number; top: number };
export type Wall = { id: string; a: [number, number]; b: [number, number]; openings: Opening[] };
export type Keyframe = { file: string; cam_to_room: number[][]; fx: number; fy: number; cx: number; cy: number; w: number; h: number };
export type Room = {
  version: 1; shell: { width: number; depth: number; height: number; walls: Wall[] };
  objects: RoomObject[]; keyframes: Keyframe[]; world_to_room: number[][];
  finishes?: { wall: string; floor: string; ceiling: string; floor_material: string; style: string };
  judge?: { model: string; views: number[]; rounds: { round: number; scores: number[]; fixes: number; kept: boolean }[]; final: number[]; issues?: string[][] };
};

export type Product = {
  id: string; title: string; title_en?: string; price: number; url: string; image: string; shop?: string; rating?: number; reviews?: number;
  rank?: number; // best-seller rank for its search on Shopee (1 = top seller)
  category: string; size?: Size; size_source: "listing" | "estimated"; color?: string; parts?: Part[]; query: string;
};

export type Pose = { x: number; z: number; yaw: number };

/** A product the agent placed in the room. */
export type Placement = { id: string; productId: string; x: number; z: number; y?: number; yaw: number; accepted?: boolean };

export type FitResult = { status: "yes" | "check" | "no"; clearance_cm: number | null; reason_en: string; reason_zh: string };

/** What the client keeps per room (localStorage) and sends to the agent each turn. */
export type RoomState = {
  placements: Placement[];
  removed: string[];                 // ids of existing objects the user wants gone or replaced
  sizeEdits: Record<string, Size>;   // user corrections ("my desk is 100 cm")
  moved?: Record<string, Pose>;      // existing furniture the user dragged somewhere else
  taste: { style?: string; budget?: number; notes?: string };
  list: string[];                    // product ids in the shopping list
};

export type Card =
  | { type: "products"; title?: string; replace?: string; items: { product: Product; fit: FitResult; placementId?: string }[] }
  | { type: "photo"; placementId: string; productId: string }
  | { type: "list" };

export type ChatTurn = { role: "user" | "assistant"; text: string; image?: string; cards?: Card[] };

/** What /api/status/<id> reports while the processing server builds an uploaded room. */
export type RoomStatus = { state: "queued" | "processing" | "done" | "failed"; stage?: "measure" | "objects" | "build" | "check" | "done"; detail?: string; error?: string };
