import type { AppData } from "../types";

const STORAGE_KEY = "meu-freela-dia:app-data:v1";

const initialData: AppData = {
  version: 1,
  members: [],
};

export function loadAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialData;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "members" in parsed &&
      (parsed as AppData).version === 1 &&
      Array.isArray((parsed as AppData).members)
    ) {
      return parsed as AppData;
    }
  } catch (error) {
    console.error("Não foi possível ler os dados locais:", error);
  }
  return initialData;
}

export function saveAppData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `meu-freela-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}