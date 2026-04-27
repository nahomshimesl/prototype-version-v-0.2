import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { App } from "firebase-admin/app";
import { promises as fs } from "fs";
import path from "path";

export interface OperatorAllowEntry {
  email: string;
  addedBy: string;
  addedAt: string;
  note?: string;
}

export interface AuditEntry {
  ts: string;
  action: "ADD" | "REMOVE";
  targetEmail: string;
  actorEmail?: string;
  actorUid: string;
}

const COLLECTION_LIST = "operatorAllowList";
const COLLECTION_AUDIT = "operatorAccessAudit";
const FALLBACK_DIR = path.join(process.cwd(), ".local");
const FALLBACK_LIST = path.join(FALLBACK_DIR, "operator-allow-list.json");
const FALLBACK_AUDIT = path.join(FALLBACK_DIR, "operator-access-audit.jsonl");
const CACHE_TTL_MS = 30_000;

export class OperatorAllowList {
  private firestore: Firestore | null = null;
  private cache: Map<string, OperatorAllowEntry> | null = null;
  private cacheTime = 0;
  private mode: "firestore" | "file" = "file";
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(adminApp: App, useFirestore: boolean) {
    if (useFirestore) {
      try {
        this.firestore = getFirestore(adminApp);
        this.mode = "firestore";
        console.log("[allowlist] using Firestore for operator allow-list persistence");
      } catch (e: any) {
        console.warn(
          "[allowlist] Firestore init failed, falling back to local file:",
          e?.message,
        );
        this.mode = "file";
      }
    } else {
      console.log(
        "[allowlist] FIREBASE_SERVICE_ACCOUNT not set — operator allow-list will use a local JSON file",
      );
    }
  }

  async list(force = false): Promise<OperatorAllowEntry[]> {
    await this.ensureCache(force);
    return [...(this.cache ?? new Map<string, OperatorAllowEntry>()).values()].sort((a, b) =>
      a.email.localeCompare(b.email),
    );
  }

  /**
   * TTL-aware membership check. Triggers a cache refresh from Firestore /
   * file when the in-memory copy is older than CACHE_TTL_MS, so revocations
   * made on a sibling server instance propagate within ~30s.
   */
  async has(email: string): Promise<boolean> {
    await this.ensureCache();
    return (this.cache ?? new Map()).has(email.toLowerCase());
  }

  async add(
    email: string,
    actor: { uid: string; email?: string },
    note?: string,
  ): Promise<OperatorAllowEntry> {
    const entry: OperatorAllowEntry = {
      email: email.toLowerCase(),
      addedBy: actor.email ?? actor.uid,
      addedAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };

    if (this.mode === "firestore" && this.firestore) {
      await this.firestore.collection(COLLECTION_LIST).doc(entry.email).set(entry);
    } else {
      await this.persistFile((m) => {
        m.set(entry.email, entry);
      });
    }
    if (this.cache) this.cache.set(entry.email, entry);

    await this.audit({
      ts: entry.addedAt,
      action: "ADD",
      targetEmail: entry.email,
      actorEmail: actor.email,
      actorUid: actor.uid,
    });
    return entry;
  }

  async remove(email: string, actor: { uid: string; email?: string }): Promise<boolean> {
    const e = email.toLowerCase();
    let removed = false;
    if (this.mode === "firestore" && this.firestore) {
      const ref = this.firestore.collection(COLLECTION_LIST).doc(e);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.delete();
        removed = true;
      }
    } else {
      await this.persistFile((m) => {
        removed = m.delete(e);
      });
    }
    if (this.cache) this.cache.delete(e);
    if (removed) {
      await this.audit({
        ts: new Date().toISOString(),
        action: "REMOVE",
        targetEmail: e,
        actorEmail: actor.email,
        actorUid: actor.uid,
      });
    }
    return removed;
  }

  async audit(entry: AuditEntry): Promise<void> {
    if (this.mode === "firestore" && this.firestore) {
      try {
        await this.firestore.collection(COLLECTION_AUDIT).add(entry);
      } catch (e: any) {
        console.warn("[allowlist] audit write failed:", e?.message);
      }
    } else {
      try {
        await fs.mkdir(FALLBACK_DIR, { recursive: true });
        await fs.appendFile(FALLBACK_AUDIT, JSON.stringify(entry) + "\n", "utf-8");
      } catch (e: any) {
        console.warn("[allowlist] audit write failed:", e?.message);
      }
    }
    console.log(
      `[allowlist:audit] ${entry.action} ${entry.targetEmail} by ${entry.actorEmail ?? entry.actorUid}`,
    );
  }

  async listAudit(limit = 100): Promise<AuditEntry[]> {
    const cap = Math.min(500, Math.max(1, limit));
    if (this.mode === "firestore" && this.firestore) {
      const snap = await this.firestore
        .collection(COLLECTION_AUDIT)
        .orderBy("ts", "desc")
        .limit(cap)
        .get();
      return snap.docs.map((d) => d.data() as AuditEntry);
    }
    try {
      const text = await fs.readFile(FALLBACK_AUDIT, "utf-8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as AuditEntry;
          } catch {
            return null;
          }
        })
        .filter((x): x is AuditEntry => x !== null)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, cap);
    } catch {
      return [];
    }
  }

  private async ensureCache(force = false): Promise<void> {
    const now = Date.now();
    if (!force && this.cache && now - this.cacheTime < CACHE_TTL_MS) return;
    if (this.mode === "firestore" && this.firestore) {
      try {
        const snap = await this.firestore.collection(COLLECTION_LIST).get();
        const map = new Map<string, OperatorAllowEntry>();
        snap.forEach((doc) => {
          const data = doc.data() as OperatorAllowEntry;
          map.set(doc.id, { ...data, email: doc.id });
        });
        this.cache = map;
        this.cacheTime = now;
        return;
      } catch (e: any) {
        console.warn(
          "[allowlist] Firestore read failed, falling back to file cache:",
          e?.message,
        );
      }
    }
    try {
      const text = await fs.readFile(FALLBACK_LIST, "utf-8");
      const arr = JSON.parse(text) as OperatorAllowEntry[];
      const map = new Map<string, OperatorAllowEntry>();
      for (const e of arr) {
        if (e?.email) map.set(e.email.toLowerCase(), e);
      }
      this.cache = map;
    } catch {
      this.cache = new Map();
    }
    this.cacheTime = now;
  }

  private async persistFile(
    mutator: (m: Map<string, OperatorAllowEntry>) => void,
  ): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureCache(true);
      const map = this.cache ?? new Map<string, OperatorAllowEntry>();
      mutator(map);
      this.cache = map;
      this.cacheTime = Date.now();
      await fs.mkdir(FALLBACK_DIR, { recursive: true });
      await fs.writeFile(
        FALLBACK_LIST,
        JSON.stringify([...map.values()], null, 2),
        "utf-8",
      );
    });
    await this.writeQueue;
  }

  /** Force-reload the cache on next read. */
  invalidate(): void {
    this.cacheTime = 0;
  }
}

export function createAllowList(adminApp: App): OperatorAllowList {
  const useFirestore =
    !!process.env.FIREBASE_SERVICE_ACCOUNT &&
    process.env.FIREBASE_SERVICE_ACCOUNT.trim().length > 0;
  return new OperatorAllowList(adminApp, useFirestore);
}
