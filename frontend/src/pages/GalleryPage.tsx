import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
    ApiError,
    GalleryListOut,
    GallerySessionSummary,
    listGallery,
} from "../api/client";

const PAGE_SIZE = 12;

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function ThumbnailGrid({ card }: { card: GallerySessionSummary }) {
    // Always render 4 slots so the grid stays visually stable regardless of
    // how many generated images exist for the session.
    const slots = Array.from({ length: 4 }, (_, i) => card.thumbnails[i] ?? null);
    return (
        <div className="grid grid-cols-4 gap-1.5">
            {slots.map((thumb, i) => (
                <div
                    key={thumb?.id ?? `empty-${i}`}
                    className="aspect-square rounded-md overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center"
                >
                    {thumb ? (
                        <img
                            src={thumb.imageUrl}
                            alt={thumb.label}
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                    )}
                </div>
            ))}
        </div>
    );
}

function SessionCard({ card }: { card: GallerySessionSummary }) {
    const detailHref = `/sessions/${card.sessionId}/results`;
    return (
        <article className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden flex flex-col">
            <div className="relative bg-slate-100 aspect-[4/3] overflow-hidden">
                {card.inputImageUrl ? (
                    <img
                        src={card.inputImageUrl}
                        alt="원본 이미지"
                        loading="lazy"
                        className="w-full h-full object-cover"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                        원본 이미지 없음
                    </div>
                )}
                <Link
                    to={detailHref}
                    aria-label="상세 보기"
                    className="absolute top-2 right-2 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/90 text-slate-700 text-xs font-medium border border-slate-200 shadow-sm hover:bg-white transition"
                >
                    상세
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </Link>
            </div>
            <div className="p-4 space-y-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <div className="text-xs text-slate-400">{formatDate(card.createdAt)}</div>
                        <div className="text-xs text-slate-500 font-mono truncate" title={card.sessionId}>
                            {card.sessionId}
                        </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium">
                        결과 {card.generationCount}
                    </span>
                </div>
                <p
                    className="text-sm text-slate-700 leading-snug line-clamp-3 min-h-[3.75rem]"
                    title={card.promptSummary ?? ""}
                >
                    {card.promptSummary ?? (
                        <span className="text-slate-400">분석 프롬프트가 아직 없습니다.</span>
                    )}
                </p>
                <ThumbnailGrid card={card} />
            </div>
        </article>
    );
}

function CardSkeleton() {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
            <div className="bg-slate-200 aspect-[4/3]" />
            <div className="p-4 space-y-3">
                <div className="h-3 bg-slate-200 rounded w-1/3" />
                <div className="h-3 bg-slate-200 rounded w-2/3" />
                <div className="h-3 bg-slate-200 rounded w-full" />
                <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="aspect-square bg-slate-200 rounded-md" />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function GalleryPage() {
    const navigate = useNavigate();
    const [data, setData] = useState<GalleryListOut | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [retryNonce, setRetryNonce] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        listGallery(page, PAGE_SIZE).then(
            (res) => {
                if (cancelled) return;
                setData(res);
                setLoading(false);
            },
            (err) => {
                if (cancelled) return;
                const msg =
                    err instanceof ApiError
                        ? `요청 실패 (${err.status})`
                        : err instanceof Error
                          ? err.message
                          : String(err);
                setError(msg);
                setLoading(false);
            }
        );
        return () => {
            cancelled = true;
        };
    }, [page, retryNonce]);

    const items = data?.items ?? [];
    const meta = data?.page;

    return (
        <div className="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        지금까지 만든 광고 세션을 최신순으로 모아 봅니다. 카드를 눌러 상세 결과로 이동할 수 있습니다.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => navigate("/")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        메인으로
                    </button>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        새로 만들기
                    </Link>
                </div>
            </header>

            {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm flex items-start justify-between gap-4">
                    <span>이력을 불러오지 못했습니다. {error}</span>
                    <button
                        type="button"
                        onClick={() => setRetryNonce((n) => n + 1)}
                        className="shrink-0 px-3 py-1 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50"
                    >
                        다시 시도
                    </button>
                </div>
            )}

            {loading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <CardSkeleton key={i} />
                    ))}
                </div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h12A2.25 2.25 0 0120.25 6v12A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18V6z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 16.5l4.5-4.5 4.5 4.5 3-3 4.5 4.5" />
                        </svg>
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-slate-800">아직 생성 이력이 없습니다</h2>
                    <p className="mt-1 text-sm text-slate-500">상품 사진 한 장으로 첫 광고 컷을 만들어 보세요.</p>
                    <Link
                        to="/"
                        className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
                    >
                        새로 만들기
                    </Link>
                </div>
            )}

            {!loading && !error && items.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map((card) => (
                        <SessionCard key={card.sessionId} card={card} />
                    ))}
                </div>
            )}

            {meta && meta.total > meta.pageSize && (
                <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500">
                        총 {meta.total}건 · {meta.page} / {Math.max(1, Math.ceil(meta.total / meta.pageSize))} 페이지
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={meta.page <= 1 || loading}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className="px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
                        >
                            이전
                        </button>
                        <button
                            type="button"
                            disabled={!meta.hasMore || loading}
                            onClick={() => setPage((p) => p + 1)}
                            className="px-3 py-1.5 rounded-lg text-sm bg-white border border-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition"
                        >
                            다음
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
