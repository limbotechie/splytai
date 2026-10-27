const STORAGE_KEY = "splyt:contacts";

function load(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function getContactName(address: string): string | null {
  return load()[address.toLowerCase()] ?? null;
}

export function setContactName(address: string, name: string): void {
  const data = load();
  const trimmed = name.trim();
  if (trimmed) {
    data[address.toLowerCase()] = trimmed;
  } else {
    delete data[address.toLowerCase()];
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}

export function removeContactName(address: string): void {
  const data = load();
  delete data[address.toLowerCase()];
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}
