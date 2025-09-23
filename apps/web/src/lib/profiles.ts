import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const ProfileSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().optional(),
    version: z.string().optional(),
    role: z.string().optional(),
    tags: z.array(z.string()).optional(),
    style: z.string().optional(),
    system: z.string().optional(),
    params: z
      .object({
        temperature: z.number().optional(),
        top_p: z.number().optional(),
        max_tokens: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export type Profile = z.infer<typeof ProfileSchema> & { __source?: string };

async function resolveProfilesDir(): Promise<string> {
  const root = process.cwd();
  const candidates = [
    path.join(root, "seeds", "profiles"),
    path.join(root, "apps", "web", "seeds", "profiles"),
  ];
  for (const p of candidates) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) return p;
    } catch {}
  }
  // если нет — создадим в первом варианте
  const target = candidates[0];
  await fs.mkdir(target, { recursive: true });
  return target;
}

export function slugifyName(name: string): string {
  const v = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return v.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "profile";
}

export async function loadProfiles(): Promise<Profile[]> {
  const dir = await resolveProfilesDir();
  const entries = await fs.readdir(dir);
  const items: Profile[] = [];
  for (const f of entries) {
    if (!f.toLowerCase().endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const parsed = ProfileSchema.parse(JSON.parse(raw));
      items.push({ ...parsed, __source: f });
    } catch (e) {
      console.warn("[profiles] skip file", f, e);
    }
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return items;
}

export function filterProfiles(
  items: Profile[],
  opts: { name?: string; kind?: string; tag?: string; q?: string }
): Profile[] {
  let res = items;
  if (opts.name) {
    const needle = opts.name.toLowerCase();
    res = res.filter((p) => p.name.toLowerCase().includes(needle));
  }
  if (opts.kind) {
    const k = opts.kind.toLowerCase();
    res = res.filter((p) => String(p.kind ?? "").toLowerCase() === k);
  }
  if (opts.tag) {
    const tags = opts.tag
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (tags.length > 0) {
      res = res.filter((p) => {
        const pt = (p.tags ?? []).map((t) => t.toLowerCase());
        return tags.every((t) => pt.includes(t));
      });
    }
  }
  if (opts.q) {
    const q = opts.q.toLowerCase();
    res = res.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  }
  return res;
}

export async function saveProfile(input: unknown): Promise<Profile> {
  const dir = await resolveProfilesDir();
  const profile = ProfileSchema.parse(input);
  const slug = slugifyName(profile.name);
  const file = path.join(dir, `${slug}.json`);
  await fs.writeFile(file, JSON.stringify(profile, null, 2) + "\n", "utf8");
  return { ...profile, __source: path.basename(file) };
}

export async function deleteProfile(nameOrFile: string): Promise<{ ok: boolean; file?: string }> {
  const dir = await resolveProfilesDir();
  // поддерживаем удаление по имени (slug) или по имени файла
  const isJsonFile = /\.json$/i.test(nameOrFile);
  const file = isJsonFile ? path.join(dir, nameOrFile) : path.join(dir, `${slugifyName(nameOrFile)}.json`);
  try {
    await fs.unlink(file);
    return { ok: true, file: path.basename(file) };
  } catch (e) {
    return { ok: false };
  }
}
