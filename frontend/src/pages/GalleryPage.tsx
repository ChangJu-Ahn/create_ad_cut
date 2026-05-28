import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    ApiError,
    GallerySessionSummary,
    listGallery,
} from "../api/client";

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString();
    } catch {
        return iso;
    }
}

interface PageState {
    items: GallerySessionSummary[];
    offset: number;
    hasMore: boolean;
}

export default function GalleryPage() {
    const navigate = useNavigate();
    const [state, setState] = useState<PageState>({ items: [], offset: 0, hasMore: false });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadPage = useCallback(async (offset: number, append: boolean) => {
        if (append) setLoadingMore(true);
        else setLoading(true);
        setError(null);
        try {
            const out = await listGallery({ limit: PAGE_SIZE, offset });
            setState((prev) => ({
                items: append ? [...prev.items, ...out.items] : out.items,
                offset: out.offset + out.items.length,
                hasMore: out.hasMore,
            }));
        } catch (err) {
            const msg =
                err instanceof ApiError
                    ? `요청 실패 (${err.status})`
                    : err instanceof Error
                      ? err.message
                      : String(err);
            setError(msg);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    useEffect(() => {
        loadPage(0, false);
    }, [loadPage]);

    return (
        <div className="max-w-screen-2xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        지금까지 만들어 본 광고 컷 세션을 최신순으로 둘러보세요.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        to="/"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        새로 만들기
                    </Link>
                </div>
            </div>

            {/* States */}
            {loading && <SkeletonGrid />}

            {!loading && error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm flex items-center justify-between">
                    <span>이력을 불러오지 못했습니다: {error}</span>
                    <button
                        type="button"
                        onClick={() => loadPage(0, false)}
                        className="ml-3 underline hover:no-underline"
                    >
                        다시 시도
                    </button>
                </div>
            )}

            {!loading && !error && state.items.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <p className="text-base font-medium text-slate-700">아직 만든 광고 컷이 없어요</p>
                    <p className="mt-1 text-sm text-slate-500">
                        상품 사진을 업로드하면 이곳에 세션이 쌓입니다.
                    </p>
                    <Link
                        to="/"
                        className="mt-5 inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        새로 만들기
                    </Link>
                </div>
            )}

            {!loading && !error && state.items.length > 0 && (
                <>
                    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                        {state.items.map((s) => (
                            <GalleryCard
                                key={s.sessionId}
                                summary={s}
                                onOpen={() => navigate(`/sessions/${s.sessionId}/results`)}
                            />
                        ))}
                    </div>

                    {state.hasMore && (
                        <div className="flex justify-center mt-8">
                            <button
                                type="button"
                                disabled={loadingMore}
                                onClick={() => loadPage(state.offset, true)}
                                className="px-5 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition"
                            >
                                {loadingMore ? "불러오는 중…" : "더 보기"}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

interface CardProps {
    summary: GallerySessionSummary;
    onOpen: () => void;
}

function GalleryCard({ summary, onOpen }: CardProps) {
    const thumbs = summary.thumbnails.slice(0, 4);
    const placeholders = Math.max(0, 4 - thumbs.length);

    return (
        <article className="group relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md hover:border-slate-300 transition">
            {/* Open detail button (top-right) */}
            <button
                type="button"
                onClick={onOpen}
                aria-label="세션 상세 보기"
                className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/90 border border-slate-200 text-slate-600 hover:bg-white hover:text-slate-900 shadow-sm transition"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
            </button>

            <button
                type="button"
                onClick={onOpen}
                className="block w-full text-left"
            >
                {/* Original image */}
                <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                    {summary.inputImageUrl ? (
                        <img
                            src={summary.inputImageUrl}
                            alt="원본 상품 사진"
                            className="w-full h-full object-cover group-hover:scale-[1.02] transition"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                            원본 이미지 없음
                        </div>
                    )}
                </div>

                <div className="p-4 space-y-3">
                    {/* Date + count */}
                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <time dateTime={summary.createdAt}>{formatDate(summary.createdAt)}</time>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            생성 {summary.generationCount}컷
                        </span>
                    </div>

                    {/* Prompt summary (truncate) */}
                    <p
                        className="text-sm text-slate-700 leading-snug min-h-[2.5rem]"
                        style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                        title={summary.promptSummary ?? undefined}
                    >
                        {summary.promptSummary?.trim() || (
                            <span className="text-slate-400">분석 프롬프트 없음</span>
                        )}
                    </p>

                    {/* Generated thumbnails (4) */}
                    <div className="grid grid-cols-4 gap-1.5">
                        {thumbs.map((t, idx) => (
                            <div
                                key={t.id || `thumb-${idx}`}
                                className="aspect-square rounded-md bg-slate-100 overflow-hidden"
                                title={t.label}
                            >
                                <img
                                    src={t.imageUrl}
                                    alt={t.label}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />
                            </div>
                        ))}
                        {Array.from({ length: placeholders }).map((_, i) => (
                            <div
                                key={`ph-${i}`}
                                className="aspect-square rounded-md bg-slate-50 border border-dashed border-slate-200"
                            />
                        ))}
                    </div>
                </div>
            </button>
        </article>
    );
}

function SkeletonGrid() {
    return (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-pulse"
                >
                    <div className="aspect-[4/3] bg-slate-100" />
                    <div className="p-4 space-y-3">
                        <div className="h-3 w-1/3 bg-slate-100 rounded" />
                        <div className="h-4 w-full bg-slate-100 rounded" />
                        <div className="h-4 w-2/3 bg-slate-100 rounded" />
                        <div className="grid grid-cols-4 gap-1.5">
                            {Array.from({ length: 4 }).map((__, j) => (
                                <div key={j} className="aspect-square bg-slate-100 rounded-md" />
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
