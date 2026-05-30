import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, GalleryCard, GalleryList, listGallery } from "../api/client";

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

function ThumbSlot({ url, label }: { url?: string; label?: string }) {
    if (!url) {
        return (
            <div className="aspect-square rounded-lg bg-slate-100 border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-300">
                없음
            </div>
        );
    }
    return (
        <div className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
            <img
                src={url}
                alt={label || "생성 결과"}
                loading="lazy"
                className="w-full h-full object-cover"
            />
        </div>
    );
}

function Card({ card }: { card: GalleryCard }) {
    const navigate = useNavigate();
    // Always render exactly 4 thumbnail slots so the grid stays consistent.
    const slots = Array.from({ length: 4 }, (_, i) => card.thumbnails[i]);

    return (
        <article className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            <header className="flex items-start justify-between gap-3 px-4 pt-4">
                <div className="min-w-0">
                    <div className="text-xs text-slate-400">{formatDate(card.createdAt)}</div>
                    <div
                        className="text-sm font-semibold text-slate-700 truncate"
                        title={card.sessionId}
                    >
                        세션 {card.sessionId.slice(0, 8)}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => navigate(`/sessions/${card.sessionId}/results`)}
                    title="상세 보기"
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-900 hover:text-white border border-slate-200 transition"
                >
                    상세
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </header>

            <div className="px-4 pt-3 grid grid-cols-[96px,1fr] gap-3">
                <div className="aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                    {card.inputImageUrl ? (
                        <img
                            src={card.inputImageUrl}
                            alt="원본 이미지"
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-300">
                            원본 없음
                        </div>
                    )}
                </div>
                <p
                    className="text-xs text-slate-600 leading-relaxed line-clamp-4"
                    title={card.promptSummary}
                >
                    {card.promptSummary || (
                        <span className="text-slate-400">분석 프롬프트가 아직 없습니다.</span>
                    )}
                </p>
            </div>

            <div className="p-4 pt-3">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                        생성 결과
                    </div>
                    <div className="text-[11px] text-slate-400">
                        {card.generationCount}개
                    </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                    {slots.map((thumb, i) => (
                        <ThumbSlot key={thumb?.id ?? i} url={thumb?.imageUrl} label={thumb?.label} />
                    ))}
                </div>
            </div>
        </article>
    );
}

export default function GalleryPage() {
    const [data, setData] = useState<GalleryList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        listGallery({ limit: PAGE_SIZE, offset })
            .then((res) => {
                if (!cancelled) setData(res);
            })
            .catch((err) => {
                if (cancelled) return;
                const msg =
                    err instanceof ApiError
                        ? `목록을 불러오지 못했습니다 (${err.status}).`
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
    }, [offset]);

    const total = data?.total ?? 0;
    const hasPrev = offset > 0;
    const hasNext = offset + PAGE_SIZE < total;

    return (
        <div className="max-w-screen-xl mx-auto px-4 py-8">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        이전에 만든 광고 컷 세션을 최신순으로 모아 보여드립니다.
                    </p>
                </div>
                <Link
                    to="/"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    메인으로
                </Link>
            </div>

            {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm mb-6">
                    {error}
                </div>
            )}

            {loading && !data && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-72 rounded-2xl border border-slate-200 bg-white animate-pulse"
                        />
                    ))}
                </div>
            )}

            {!loading && data && data.items.length === 0 && !error && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
                    <div className="text-5xl mb-3">🗂️</div>
                    <div className="text-base font-semibold text-slate-700">
                        아직 생성한 광고 컷이 없습니다.
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                        메인 화면에서 상품 사진을 업로드해 첫 광고 컷을 만들어 보세요.
                    </p>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        새로 만들기
                    </Link>
                </div>
            )}

            {data && data.items.length > 0 && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {data.items.map((card) => (
                            <Card key={card.sessionId} card={card} />
                        ))}
                    </div>

                    {(hasPrev || hasNext) && (
                        <div className="flex items-center justify-between mt-8">
                            <button
                                type="button"
                                disabled={!hasPrev || loading}
                                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                                className="px-4 py-2 rounded-lg text-sm border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                이전
                            </button>
                            <div className="text-xs text-slate-500">
                                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total}
                            </div>
                            <button
                                type="button"
                                disabled={!hasNext || loading}
                                onClick={() => setOffset(offset + PAGE_SIZE)}
                                className="px-4 py-2 rounded-lg text-sm border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
