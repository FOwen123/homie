// Room files (/rooms/<id>/room.json, keyframes, crops): the site's own for the demo, else the processing
// server's for visitors' rooms, which live there (pipeline/modal_app.py) and are never deployed with the site.
import { type Env, roomFile } from "../../_lib";

export const onRequestGet: PagesFunction<Env & { ROOMIE_UPLOAD_TOKEN: string }> = async ({ request, env, params }) => {
  const path = ([] as string[]).concat(params.path ?? []).join("/");
  if (!/^(room\.json|(keyframes|crops)\/[a-z0-9_]+\.jpg)$/.test(path)) return new Response("not found", { status: 404 });
  return roomFile(env, request, String(params.id), path);
};
