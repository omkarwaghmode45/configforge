import type { Session } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:10000").replace(/\/+$/, "");
const DEFAULT_CONFIG_KEY = "app";

function getActiveConfigKey() {
  if (typeof window === "undefined") return DEFAULT_CONFIG_KEY;
  return new URLSearchParams(window.location.search).get("config") || DEFAULT_CONFIG_KEY;
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  session?: Session | null
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const url = new URL(`${API_BASE}${path}`);
  const configKey = getActiveConfigKey();
  if (configKey && configKey !== DEFAULT_CONFIG_KEY) {
    url.searchParams.set("config", configKey);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...options,
      headers,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Network request failed";
    throw new Error(`Unable to reach API at ${API_BASE}${path}: ${detail}`);
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let message = raw;
    if (raw) {
      try {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        if (payload && typeof payload === "object" && "error" in payload) {
          message = String(payload.error || message);
        }
      } catch {
        // Ignore non-JSON bodies and fall back to the raw text below.
      }
    }

    throw new Error(message || `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON response for ${path}`);
  }

  return response.json() as Promise<T>;
}