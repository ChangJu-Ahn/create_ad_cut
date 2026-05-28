import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
    ApiError,
    GalleryDetail,
    GalleryItem,
    getGalleryItem,
    listGallery,
} from "../api/client";

const PAGE_SIZE = 24;

function formatError(err: unknown): string {
    if (err instanceof ApiError) {
        const detail =
            typeof err.detail === "object" && err.detail !== null
                ? // FastAPI error envelope: { detail: { code, message } }
                  (err.detail as { detail?: { message?: string }; message?: string }).detail?.message ??
                  (err.detail as { message?: string }).message ??
                  JSON.stringify(err.detail)
                : String(err.detail);
        return `요청 실패 (${err.status}): ${detail}`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export default function GalleryPage() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [nextOffset, setNextOffset] = useState<number | null>(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    // Remember which card the user opened detail from, so returning preserves context.
    const lastSelectedRef = useRef<string | null>(null);

    const loadPage = useCallback(async (offset: number) => {
        setLoading(true);
        setError(null);
        try {
            const page = await listGallery({ limit: PAGE_SIZE, offset });
            setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
            setNextOffset(page.nextOffset);
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPage(0);
    }, [loadPage]);

    function openDetail(id: string) {
        lastSelectedRef.current = id;
        setSelectedId(id);
    }

    function closeDetail() {
        setSelectedId(null);
        // Defer focus restore so the grid item exists in the DOM.
        requestAnimationFrame(() => {
            const id = lastSelectedRef.current;
            if (!id) return;
            const el = document.getElementById(`gallery-card-${id}`);
            el?.focus({ preventScroll: false });
            el?.scrollIntoView({ block: "nearest" });
        });
    }

    const isEmpty = !loading && !error && items.length === 0;

    return (
        <div className="max-w-screen-2xl mx-auto px-4 py-8">
            <div className="flex items-end justify-between mb-6">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">Gallery</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        지금까지 생성된 광고 컷을 최신순으로 모아봅니다.
                    </p>
                </div>
                <Link
                    to="/"
                    className="text-sm text-slate-600 hover:text-slate-900 underline-offset-4 hover:underline"
                >
                    새로 생성하기 →
                </Link>
            </div>

            {/* Error banner */}
            {error && (
                <div
                    role="alert"
                    className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm mb-6 flex items-center justify-between gap-4"
                >
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => loadPage(items.length === 0 ? 0 : items.length)}
                        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100 transition text-xs font-medium"
                    >
                        다시 시도
                    </button>
                </div>
            )}

            {/* Empty state */}
            {isEmpty && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <svg
                        className="mx-auto w-10 h-10 text-slate-300"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3 16.5l4.5-4.5 3 3 6-6L21 13.5M3 6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v10.5A2.25 2.25 0 0118.75 19.5H5.25A2.25 2.25 0 013 17.25V6.75z"
                        />
                    </svg>
                    <p className="mt-3 text-sm text-slate-500">아직 생성된 광고 컷이 없습니다.</p>
                    <Link
                        to="/"
                        className="inline-flex mt-4 items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        첫 컷 만들러 가기
                    </Link>
                </div>
            )}

            {/* Grid */}
            {items.length > 0 && (
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {items.map((it) => (
                        <li key={it.id}>
                            <button
                                type="button"
                                id={`gallery-card-${it.id}`}
                                onClick={() => openDetail(it.id)}
                                className="group w-full text-left rounded-xl overflow-hidden bg-white border border-slate-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-900/30 transition"
                            >
                                <div className="aspect-square bg-slate-100 overflow-hidden">
                                    <img
                                        src={it.imageUrl}
                                        alt={it.label}
                                        loading="lazy"
                                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                                    />
                                </div>
                                <div className="p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                                            {it.mode}
                                        </span>
                                        <span className="text-xs text-slate-400 truncate">
                                            {formatDate(it.createdAt)}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-sm font-medium text-slate-800 truncate">
                                        {it.label}
                                    </p>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {/* Loading skeleton */}
            {loading && items.length === 0 && (
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <li
                            key={i}
                            className="rounded-xl bg-white border border-slate-200 overflow-hidden"
                        >
                            <div className="aspect-square bg-slate-100 animate-pulse" />
                            <div className="p-3 space-y-2">
                                <div className="h-3 w-2/3 bg-slate-100 rounded animate-pulse" />
                                <div className="h-3 w-1/2 bg-slate-100 rounded animate-pulse" />
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Load more */}
            {nextOffset !== null && items.length > 0 && (
                <div className="flex justify-center mt-8">
                    <button
                        type="button"
                        onClick={() => loadPage(nextOffset)}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium text-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        {loading ? "불러오는 중…" : "더 보기"}
                    </button>
                </div>
            )}

            {selectedId && <GalleryDetailPanel generationId={selectedId} onClose={closeDetail} />}
        </div>
    );
}

interface DetailPanelProps {
    generationId: string;
    onClose: () => void;
}

function GalleryDetailPanel({ generationId, onClose }: DetailPanelProps) {
    const [detail, setDetail] = useState<GalleryDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setDetail(await getGalleryItem(generationId));
        } catch (err) {
            setError(formatError(err));
        } finally {
            setLoading(false);
        }
    }, [generationId]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Gallery 상세"
        >
            <div
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-6 py-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">
                        {detail?.label ?? "상세"}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-500 hover:text-slate-900 text-sm px-2 py-1 rounded hover:bg-slate-100"
                        aria-label="닫기"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-6">
                    {loading && (
                        <div className="py-16 text-center text-sm text-slate-500">불러오는 중…</div>
                    )}

                    {error && (
                        <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm flex items-center justify-between gap-4">
                            <span>{error}</span>
                            <button
                                type="button"
                                onClick={load}
                                className="px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 hover:bg-red-100 transition text-xs font-medium"
                            >
                                다시 시도
                            </button>
                        </div>
                    )}

                    {detail && !loading && !error && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                                        생성 결과
                                    </p>
                                    <img
                                        src={detail.imageUrl}
                                        alt={detail.label}
                                        className="w-full rounded-xl border border-slate-200 object-contain bg-slate-50"
                                    />
                                </div>
                                {detail.inputImageUrl && (
                                    <div>
                                        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                                            원본 입력
                                        </p>
                                        <img
                                            src={detail.inputImageUrl}
                                            alt="원본 입력"
                                            className="w-full rounded-xl border border-slate-200 object-contain bg-slate-50"
                                        />
                                    </div>
                                )}
                            </div>

                            <dl className="space-y-4 text-sm">
                                <div>
                                    <dt className="text-xs uppercase tracking-wide text-slate-400">
                                        Mode
                                    </dt>
                                    <dd className="text-slate-800">{detail.mode}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs uppercase tracking-wide text-slate-400">
                                        생성 시각
                                    </dt>
                                    <dd className="text-slate-800">{formatDate(detail.createdAt)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs uppercase tracking-wide text-slate-400">
                                        Session
                                    </dt>
                                    <dd>
                                        <Link
                                            to={`/sessions/${detail.sessionId}/results`}
                                            className="text-slate-700 hover:text-slate-900 underline underline-offset-2 break-all"
                                        >
                                            {detail.sessionId}
                                        </Link>
                                    </dd>
                                </div>
                                {detail.promptHeader && (
                                    <div>
                                        <dt className="text-xs uppercase tracking-wide text-slate-400">
                                            Prompt header
                                        </dt>
                                        <dd>
                                            <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700">
                                                {detail.promptHeader}
                                            </pre>
                                        </dd>
                                    </div>
                                )}
                                {detail.usedPrompt && (
                                    <div>
                                        <dt className="text-xs uppercase tracking-wide text-slate-400">
                                            전체 프롬프트
                                        </dt>
                                        <dd>
                                            <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 max-h-64 overflow-y-auto">
                                                {detail.usedPrompt}
                                            </pre>
                                        </dd>
                                    </div>
                                )}
                                {detail.promptMd && (
                                    <div>
                                        <dt className="text-xs uppercase tracking-wide text-slate-400">
                                            분석 프롬프트 (메모)
                                        </dt>
                                        <dd>
                                            <pre className="whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 max-h-48 overflow-y-auto">
                                                {detail.promptMd}
                                            </pre>
                                        </dd>
                                    </div>
                                )}
                            </dl>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
