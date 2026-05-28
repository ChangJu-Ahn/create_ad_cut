import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listSessions, SessionListItem } from "../api/client";

export default function GalleryPage() {
    const [items, setItems] = useState<SessionListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        listSessions(50)
            .then((res) => setItems(res.items))
            .catch((err) => {
                const msg =
                    err instanceof ApiError
                        ? `요청 실패 (${err.status}): ${JSON.stringify(err.detail)}`
                        : err instanceof Error
                          ? err.message
                          : String(err);
                setError(msg);
            })
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
            <div className="flex items-end justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">생성 이력</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        지금까지 만든 광고 컷을 새로 만든 순서대로 보여줍니다. 입력 이미지 · 분석 프롬프트 · 생성 결과가 모두 보존됩니다.
                    </p>
                </div>
                <Link
                    to="/"
                    className="text-sm font-medium text-slate-600 hover:text-slate-900 transition"
                >
                    새로 만들기 →
                </Link>
            </div>

            {error && (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">
                    {error}
                </div>
            )}

            <div data-testid="gallery-list" className="space-y-4">
                {loading && <div className="text-sm text-slate-500">불러오는 중…</div>}
                {!loading && items.length === 0 && (
                    <div data-testid="gallery-empty" className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
                        <p className="text-sm text-slate-500">아직 생성된 광고 컷이 없습니다.</p>
                        <Link to="/" className="inline-block mt-3 text-sm font-medium text-slate-900 underline underline-offset-2">
                            첫 번째 컷 만들기
                        </Link>
                    </div>
                )}
                {items.map((item) => (
                    <SessionCard key={item.sessionId} item={item} />
                ))}
            </div>
        </div>
    );
}

function SessionCard({ item }: { item: SessionListItem }) {
    const created = new Date(item.createdAt).toLocaleString();
    const previewPrompt = (item.promptMd ?? "").trim().slice(0, 220);
    const gens = item.generations;

    return (
        <article data-testid="gallery-item" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 sm:px-6 py-3 border-b border-slate-100 flex items-center justify-between">
                <div className="text-xs text-slate-500">
                    <span className="font-mono">{item.sessionId.slice(0, 8)}</span>
                    <span className="mx-2">·</span>
                    <span>{created}</span>
                    <span className="mx-2">·</span>
                    <span>생성 {gens.length}개</span>
                </div>
                <Link to={`/sessions/${item.sessionId}/results`} className="text-xs font-medium text-slate-600 hover:text-slate-900 transition">
                    상세 →
                </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 p-5 sm:p-6">
                <div className="space-y-2">
                    <div className="text-xs font-medium text-slate-500">원본</div>
                    {item.inputImageUrl ? (
                        <img src={item.inputImageUrl} alt="원본 이미지" className="w-full aspect-square object-cover rounded-lg border border-slate-200 bg-slate-50" />
                    ) : (
                        <div className="w-full aspect-square rounded-lg border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-xs text-slate-400">없음</div>
                    )}
                </div>

                <div className="space-y-3 min-w-0">
                    <div>
                        <div className="text-xs font-medium text-slate-500 mb-1">분석 프롬프트</div>
                        {previewPrompt ? (
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {previewPrompt}
                                {(item.promptMd ?? "").length > previewPrompt.length && "…"}
                            </p>
                        ) : (
                            <p className="text-sm text-slate-400 italic">(분석 전)</p>
                        )}
                    </div>

                    <div>
                        <div className="text-xs font-medium text-slate-500 mb-2">생성 결과</div>
                        {gens.length === 0 ? (
                            <p className="text-sm text-slate-400 italic">(아직 생성 결과 없음)</p>
                        ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {gens.map((g) => (
                                    <a key={g.id} href={g.imageUrl} target="_blank" rel="noreferrer" className="group block" title={g.label}>
                                        <img src={g.imageUrl} alt={g.label} className="w-full aspect-square object-cover rounded-md border border-slate-200 bg-slate-50 group-hover:border-slate-400 transition" />
                                        <div className="text-[11px] text-slate-500 mt-1 truncate">{g.label}</div>
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </article>
    );
}
