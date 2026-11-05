import { type Env, json, loadCatalog } from "../_lib";
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => json(await loadCatalog(env, request));
