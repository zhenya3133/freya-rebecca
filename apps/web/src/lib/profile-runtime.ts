// apps/web/src/lib/profile-runtime.ts
import type { NextRequest } from "next/server";
import { loadProfiles, type Profile } from "@/lib/profiles";

export type ModelParams = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

export type AppliedProfile = {
  profileName: string;  // выбранное имя профиля
  system: string;       // persona + style из профиля (склеено)
  params: ModelParams;  // дефолтные параметры модели из профиля
  profile?: Profile;    // исходный профиль (на всякий)
};

function composeSystem(p?: Profile): string {
  const parts: string[] = [];
  if (p?.system) parts.push(String(p.system).trim());
  if (p?.style)  parts.push(`Стиль: ${String(p.style).trim()}`);
  return parts.filter(Boolean).join("\n\n");
}

async function findProfile(name?: string): Promise<Profile | undefined> {
  const list = await loadProfiles();
  const n = (name || "").toLowerCase().trim();
  let p = n ? list.find(x => x.name.toLowerCase() === n) : undefined;
  if (!p) p = list.find(x => x.name.toLowerCase() === "qa"); // дефолт
  return p;
}

export async function getAppliedProfile(name?: string): Promise<AppliedProfile> {
  const p = await findProfile(name);
  return {
    profileName: p?.name || (name || "qa"),
    system: composeSystem(p),
    params: {
      temperature: p?.params?.temperature,
      top_p:       p?.params?.top_p,
      max_tokens:  p?.params?.max_tokens,
    },
    profile: p,
  };
}

export async function appliedProfileFromRequest(req: NextRequest, body?: any) {
  const url = new URL(req.url);
  const name =
    body?.profileName ??
    body?.profile ??
    url.searchParams.get("profileName") ??
    url.searchParams.get("profile") ??
    undefined;
  return getAppliedProfile(name);
}

export function mergeParams(base: ModelParams, overrides?: ModelParams): ModelParams {
  return {
    temperature: overrides?.temperature ?? base.temperature,
    top_p:       overrides?.top_p       ?? base.top_p,
    max_tokens:  overrides?.max_tokens  ?? base.max_tokens,
  };
}
