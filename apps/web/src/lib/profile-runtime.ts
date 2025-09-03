// apps/web/src/lib/profile-runtime.ts
import type { NextRequest } from "next/server";
import { loadProfiles, type Profile } from "@/lib/profiles";

export type ModelParams = {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
};

export type AppliedProfile = {
  profileName: string;
  system: string;
  params: ModelParams;
  profile?: Profile;
};

function composeSystem(p?: Profile): string {
  const parts: string[] = [];
  if (p?.system) parts.push(String(p.system).trim());
  if (p?.style)  parts.push(`Стиль: ${String(p.style).trim()}`);
  return parts.filter(Boolean).join("\n\n");
}

async function lookupProfile(name?: string): Promise<Profile | undefined> {
  const list = await loadProfiles();
  const n = (name || "").toLowerCase().trim();
  let p = n ? list.find(x => x.name.toLowerCase() === n) : undefined;
  if (!p) p = list.find(x => x.name.toLowerCase() === "qa"); // дефолт
  return p;
}

export async function getAppliedProfile(nameOrProfile?: string | Profile): Promise<AppliedProfile> {
  const p = (typeof nameOrProfile === "object" && nameOrProfile?.name)
    ? (nameOrProfile as Profile)
    : await lookupProfile(nameOrProfile as string | undefined);

  return {
    profileName: p?.name || (typeof nameOrProfile === "string" ? nameOrProfile : "qa"),
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

// Обратная совместимость: где-то ещё могут импортировать findProfile.
// Важно: теперь это alias, который возвращает AppliedProfile, а не Profile!
export { getAppliedProfile as findProfile };
