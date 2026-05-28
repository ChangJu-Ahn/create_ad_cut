/**
 * Tiny fetch wrapper around the backend API.
 *
 * In production the SWA Linked Backend mounts the backend under `/api`, so
 * we always call relative `/api/...` URLs. Locally Vite proxies `/api/*` to
 * `http://localhost:8000` and strips the prefix.
 *
 * PR previews override this with VITE_API_BASE_URL at build time, pointing
 * the frontend at the per-PR ACA revision FQDN so reviewers and Playwright
 * exercise the PR's backend before merge.
 */

// Absolute URL (with trailing path) when overridden, otherwise relative `/api`.
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "/api";

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

export interface GenerateJobLogEntry {
    ts: string;
    tempId: string | null;
    label: string | null;
    message: string;
}

export interface GenerateJobOut {
    sessionId: string;
    jobId: string;
    status: JobStatus;
    items: GenerateJobItem[];
    logs: GenerateJobLogEntry[];
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
    jobs: GenerateJobOut[];
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

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

// ---- Board -----------------------------------------------------------------

export interface BoardPost {
    postId: string;
    title: string;
    body: string;
    author: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface BoardPostListItem {
    postId: string;
    title: string;
    author: string | null;
    createdAt: string;
    excerpt: string;
}

export interface BoardPostList {
    items: BoardPostListItem[];
}

export interface BoardPostInput {
    title: string;
    body: string;
    author?: string;
}

export function listBoardPosts(limit = 20) {
    return request<BoardPostList>(`/board?limit=${encodeURIComponent(limit)}`);
}

export function getBoardPost(postId: string) {
    return request<BoardPost>(`/board/${encodeURIComponent(postId)}`);
}

export function createBoardPost(input: BoardPostInput) {
    return request<BoardPost>("/board", {
        method: "POST",
        body: JSON.stringify(input),
    });
}
