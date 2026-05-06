/**
 * Tiny fetch wrapper around the backend API.
 *
 * In production the SWA Linked Backend mounts the backend under `/api`, so
 * we always call relative `/api/...` URLs. Locally Vite proxies `/api/*` to
 * `http://localhost:8000` and strips the prefix.
 */

const API_KEY_STORAGE = "create-ad-cut.apiKey";

export type BuiltInMode = "lookbook" | "front" | "side" | "back";
export type ShotMode = BuiltInMode | "custom";

export interface SessionCreated {
    sessionId: string;
    createdAt: string;
}

export interface AnalyzeOut {
    sessionId: string;
    inputImageUrl: string;
    promptMd: string;
    model: string;
    analyzedAt: string;
}

export interface StyleHeaderInfo {
    mode: BuiltInMode;
    label: string;
    description: string;
    header: string;
    useReference: boolean;
    sceneCompose: boolean;
}

export interface GenerateItem {
    mode: ShotMode;
    label?: string;
    promptHeader?: string;
    useReference?: boolean;
    sceneCompose?: boolean;
    includeAnalysisPrompt?: boolean;
}

export interface GenerationResult {
    id: string;
    mode: ShotMode;
    label: string;
    imageUrl: string;
    promptHeader: string;
    usedPrompt: string;
    createdAt: string;
}

// ---- Async generate jobs ---------------------------------------------------

export type JobStatus = "running" | "done" | "partial" | "failed";
export type JobItemStatus = "pending" | "running" | "done" | "failed";

export interface GenerateJobItem {
    tempId: string;
    mode: ShotMode;
    label: string;
    status: JobItemStatus;
    generationId: string | null;
    error: string | null;
}

export interface GenerateJobOut {
    sessionId: string;
    jobId: string;
    status: JobStatus;
    items: GenerateJobItem[];
    createdAt: string;
    updatedAt: string;
}

export interface SessionView {
    sessionId: string;
    createdAt: string;
    updatedAt: string;
    inputImageUrl: string | null;
    promptMd: string | null;
    generations: GenerationResult[];
}

export function getApiKey(): string {
    return localStorage.getItem(API_KEY_STORAGE) ?? "";
}

export function setApiKey(key: string): void {
    localStorage.setItem(API_KEY_STORAGE, key);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("X-API-Key", getApiKey());
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`/api${path}`, { ...init, headers });

    if (!res.ok) {
        let detail: unknown = null;
        try {
            const text = await res.text();
            try {
                detail = JSON.parse(text);
            } catch {
                detail = text;
            }
        } catch {
            detail = `HTTP ${res.status}`;
        }
        throw new ApiError(res.status, detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
}

export class ApiError extends Error {
    constructor(
        public status: number,
        public detail: unknown
    ) {
        super(`API error ${status}`);
    }
}

// ---- Endpoints --------------------------------------------------------------

export function createSession() {
    return request<SessionCreated>("/sessions", { method: "POST" });
}

export function analyze(sessionId: string, file: File, detailNote?: string) {
    const fd = new FormData();
    fd.append("image", file);
    if (detailNote) fd.append("detail_note", detailNote);
    return request<AnalyzeOut>(`/sessions/${sessionId}/analyze`, {
        method: "POST",
        body: fd,
    });
}

export function updatePrompt(sessionId: string, promptMd: string) {
    return request<{ sessionId: string; promptMd: string; updatedAt: string }>(
        `/sessions/${sessionId}/prompt`,
        { method: "PATCH", body: JSON.stringify({ promptMd }) }
    );
}

export function generate(sessionId: string, items: GenerateItem[]) {
    return request<GenerateJobOut>(`/sessions/${sessionId}/generate`, {
        method: "POST",
        body: JSON.stringify({ items }),
    });
}

export function getGenerateJob(sessionId: string, jobId: string) {
    return request<GenerateJobOut>(`/sessions/${sessionId}/generate/jobs/${jobId}`);
}

export function getSession(sessionId: string) {
    return request<SessionView>(`/sessions/${sessionId}`);
}

export function listStyleHeaders() {
    return request<StyleHeaderInfo[]>("/style-headers");
}
