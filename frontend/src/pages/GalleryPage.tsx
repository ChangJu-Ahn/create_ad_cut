import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, GalleryCard, GalleryList, listGallery } from "../api/client";

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

function ThumbnailGrid({ card }: { card: GalleryCard }) {
    // Always render 4 slots so the grid stays uniform across cards.
    const slots = [0, 1, 2, 3];
    return (
        <div className="grid grid-cols-2 gap-1.5">
            {slots.map((i) => {
                const t = card.thumbnails[i];
                if (!t) {
                    return (
                        <div
                            key={i}
                            className="aspect-square rounded-md bg-slate-100 border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-300"
                        >
                            없음
                        </div>
                    );
                }
                return (
                    <div
                        key={t.id}
                        className="relative aspect-square overflow-hidden rounded-md bg-slate-100 border border-slate-200"
                        title={t.label}
                    >
                        <img
                            src={t.imageUrl}
                            alt={t.label}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[10px] px-1 py-0.5 truncate">
                            {t.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function SessionCardView({ card }: { card: GalleryCard }) {
    const detailHref = `/sessions/${card.sessionId}/results`;
    return (
        <article className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col">
            <div className="flex items-start justify-between gap-2 px-4 pt-4">
                <div className="min-w-0">
                    <div className="text-xs text-slate-400">{formatDate(card.createdAt)}</div>
                    <div className="text-sm font-semibold text-slate-700 truncate">
                        세션 {card.sessionId.slice(0, 8)}
                    </div>
                </div>
                <Link
                    to={detailHref}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded-md hover:bg-slate-100 transition"
                    aria-label="세션 상세 보기"
                >
                    상세
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
                {/* Original photo */}
                <div className="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center">
                    {card.inputImageUrl ? (
                        <img
                            src={card.inputImageUrl}
                            alt="원본 이미지"
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="text-xs text-slate-400">원본 없음</span>
                    )}
                </div>
                {/* 4 generation thumbnails */}
                <ThumbnailGrid card={card} />
            </div>

            <div className="px-4 pb-4 -mt-1">
                <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                    분석 프롬프트
                </div>
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 min-h-[2.25rem]">
                    {card.promptSummary || (
                        <span className="text-slate-300">프롬프트가 아직 없습니다.</span>
                    )}
                </p>
                <div className="mt-2 text-[11px] text-slate-400">
                    생성 결과 {card.generationCount}개
                </div>
            </div>
        </article>
    );
}

export default function GalleryPage() {
    const navigate = useNavigate();
    const [data, setData] = useState<GalleryList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);
    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        listGallery(PAGE_SIZE, offset)
            .then((res) => {
                if (!cancelled) setData(res);
            })
            .catch((err) => {
                if (cancelled) return;
                const msg =
                    err instanceof ApiError
                        ? `목록을 불러오지 못했습니다 (${err.status})`
                        : err instanceof Error
                          ? err.message
                          : String(err);
                setError(msg);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [offset, reloadTick]);

    const total = data?.total ?? 0;
    const hasPrev = offset > 0;
    const hasNext = data ? offset + data.items.length < total : false;

    return (
        <div className="max-w-screen-xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        지금까지 만든 광고 컷 세션을 최신순으로 확인할 수 있습니다.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    새로 만들기
                </button>
            </div>

            {/* States */}
            {loading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-72 rounded-2xl bg-white border border-slate-200 animate-pulse"
                        />
                    ))}
                </div>
            )}

            {!loading && error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button
                        type="button"
                        onClick={() => setReloadTick((n) => n + 1)}
                        className="ml-4 text-xs underline"
                    >
                        다시 시도
                    </button>
                </div>
            )}

            {!loading && !error && data && data.items.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <div className="text-slate-400 text-sm">아직 생성한 세션이 없습니다.</div>
                    <button
                        type="button"
                        onClick={() => navigate("/")}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        첫 광고 컷 만들기
                    </button>
                </div>
            )}

            {!loading && !error && data && data.items.length > 0 && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.items.map((card) => (
                            <SessionCardView key={card.sessionId} card={card} />
                        ))}
                    </div>

                    {(hasPrev || hasNext) && (
                        <div className="mt-6 flex items-center justify-between text-sm">
                            <button
                                type="button"
                                disabled={!hasPrev}
                                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                이전
                            </button>
                            <span className="text-slate-400 text-xs">
                                {offset + 1}–{offset + data.items.length} / {total}
                            </span>
                            <button
                                type="button"
                                disabled={!hasNext}
                                onClick={() => setOffset(offset + PAGE_SIZE)}
                                className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                다음
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
