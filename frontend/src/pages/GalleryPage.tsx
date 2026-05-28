import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, GalleryItem, listGallery } from "../api/client";

const PAGE_SIZE = 12;

function formatTimestamp(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleString("ko-KR", {
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

export default function GalleryPage() {
    const [items, setItems] = useState<GalleryItem[]>([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [initialized, setInitialized] = useState(false);

    const loadPage = useCallback(async (nextOffset: number, replace: boolean) => {
        setLoading(true);
        setError(null);
        try {
            const out = await listGallery(PAGE_SIZE, nextOffset);
            setItems((prev) => (replace ? out.items : [...prev, ...out.items]));
            setOffset(nextOffset + out.items.length);
            setHasMore(out.hasMore);
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
            setInitialized(true);
        }
    }, []);

    useEffect(() => {
        loadPage(0, true);
    }, [loadPage]);

    return (
        <div className="max-w-screen-2xl mx-auto px-4 py-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        이전에 만든 광고 컷 세션을 최신순으로 확인하고 상세 보기로 이동하세요.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => loadPage(0, true)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm hover:bg-slate-50 disabled:opacity-40 transition"
                    >
                        새로 고침
                    </button>
                    <Link
                        to="/"
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        + 새로 만들기
                    </Link>
                </div>
            </div>

            {/* Body */}
            {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm mb-4">
                    {error}
                </div>
            )}

            {!initialized && loading ? (
                <GalleryLoading />
            ) : items.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {items.map((it) => (
                        <GalleryCard key={it.sessionId} item={it} />
                    ))}
                </div>
            )}

            {hasMore && (
                <div className="flex justify-center mt-6">
                    <button
                        type="button"
                        onClick={() => loadPage(offset, false)}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition"
                    >
                        {loading ? "불러오는 중…" : "더 보기"}
                    </button>
                </div>
            )}
        </div>
    );
}

function GalleryCard({ item }: { item: GalleryItem }) {
    const thumbs = item.thumbnails.slice(0, 4);
    // Render a single-row 4-up strip; missing slots show a placeholder so
    // layout stays consistent across cards.
    const slots: (GalleryItem["thumbnails"][number] | null)[] = [
        ...thumbs,
        ...Array<null>(Math.max(0, 4 - thumbs.length)).fill(null),
    ];

    return (
        <article className="group relative bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden">
            {/* Detail action — top-right */}
            <Link
                to={`/sessions/${item.sessionId}/results`}
                aria-label="상세 보기"
                title="상세 보기"
                className="absolute top-3 right-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded-full bg-white/90 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-white shadow-sm transition"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
            </Link>

            <div className="p-4 flex gap-4">
                {/* Original image */}
                <div className="shrink-0 w-24 h-24 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center">
                    {item.inputImageUrl ? (
                        <img
                            src={item.inputImageUrl}
                            alt="원본"
                            loading="lazy"
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="text-[10px] text-slate-400">원본 없음</span>
                    )}
                </div>

                {/* Prompt summary */}
                <div className="min-w-0 flex-1 pr-8">
                    <div className="text-[11px] text-slate-400 mb-1">
                        {formatTimestamp(item.createdAt)}
                    </div>
                    <p
                        className="text-sm text-slate-700 leading-snug overflow-hidden"
                        style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                        }}
                        title={item.promptMd ?? item.promptSummary ?? undefined}
                    >
                        {item.promptSummary || (
                            <span className="text-slate-400">분석 프롬프트가 아직 없습니다.</span>
                        )}
                    </p>
                </div>
            </div>

            {/* Thumbnails: 4-up strip of generations */}
            <div className="px-4 pb-4">
                <div className="grid grid-cols-4 gap-1.5">
                    {slots.map((g, i) =>
                        g ? (
                            <div
                                key={g.id || i}
                                className="aspect-square rounded-md overflow-hidden bg-slate-100 border border-slate-200"
                                title={g.label}
                            >
                                <img
                                    src={g.imageUrl}
                                    alt={g.label}
                                    loading="lazy"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        ) : (
                            <div
                                key={`empty-${i}`}
                                className="aspect-square rounded-md bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center"
                            >
                                <span className="text-[10px] text-slate-300">없음</span>
                            </div>
                        )
                    )}
                </div>
                <div className="mt-2 text-[11px] text-slate-400">
                    생성 결과 {item.generationCount}개
                </div>
            </div>
        </article>
    );
}

function GalleryLoading() {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    className="bg-white rounded-2xl border border-slate-200 p-4 animate-pulse"
                >
                    <div className="flex gap-4">
                        <div className="w-24 h-24 rounded-lg bg-slate-100" />
                        <div className="flex-1 space-y-2">
                            <div className="h-3 w-1/3 bg-slate-100 rounded" />
                            <div className="h-3 w-full bg-slate-100 rounded" />
                            <div className="h-3 w-5/6 bg-slate-100 rounded" />
                        </div>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 mt-4">
                        {Array.from({ length: 4 }).map((_, j) => (
                            <div key={j} className="aspect-square rounded-md bg-slate-100" />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5v10.5H3.75z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 17.25l4.5-4.5 4.5 4.5 3-3 4.5 4.5" />
                </svg>
            </div>
            <h2 className="text-base font-semibold text-slate-700">아직 생성 이력이 없어요</h2>
            <p className="text-sm text-slate-500 mt-1">
                첫 광고 컷을 만들어 보세요. 생성한 결과가 이곳에 카드로 쌓입니다.
            </p>
            <div className="mt-4">
                <Link
                    to="/"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                >
                    새로 만들기
                </Link>
            </div>
        </div>
    );
}
