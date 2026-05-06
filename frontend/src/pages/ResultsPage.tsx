import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ApiError,
    GenerateItem,
    GenerationResult,
    ShotMode,
    generate,
    getSession,
    SessionView,
} from "../api/client";
import StepIndicator from "../components/StepIndicator";

interface Group {
    key: string;
    mode: ShotMode;
    label: string;
    items: GenerationResult[]; // ordered oldest → newest
}

function groupKey(g: GenerationResult): string {
    // Group by mode for built-ins, by mode+label for customs so each named
    // custom cut keeps its own slider and re-generations stack inside it.
    return g.mode === "custom" ? `custom::${g.label}` : g.mode;
}

function groupGenerations(gens: GenerationResult[]): Group[] {
    const map = new Map<string, Group>();
    for (const g of gens) {
        const key = groupKey(g);
        const existing = map.get(key);
        if (existing) {
            existing.items.push(g);
        } else {
            map.set(key, { key, mode: g.mode, label: g.label, items: [g] });
        }
    }
    return Array.from(map.values());
}

export default function ResultsPage() {
    const { sessionId = "" } = useParams();
    const navigate = useNavigate();
    const [session, setSession] = useState<SessionView | null>(null);
    const [error, setError] = useState<string | null>(null);
    // For each group key: current slide index (0-based) + per-group regenerate state
    const [slideIndex, setSlideIndex] = useState<Record<string, number>>({});
    const [regenBusy, setRegenBusy] = useState<Record<string, boolean>>({});
    const [regenError, setRegenError] = useState<Record<string, string>>({});

    useEffect(() => {
        getSession(sessionId).then(setSession, (e) =>
            setError(e instanceof Error ? e.message : String(e))
        );
    }, [sessionId]);

    const groups = useMemo(() => (session ? groupGenerations(session.generations) : []), [session]);

    // Whenever a new image is appended, jump that group's slider to the latest.
    useEffect(() => {
        setSlideIndex((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const g of groups) {
                if (next[g.key] === undefined || next[g.key] >= g.items.length) {
                    next[g.key] = g.items.length - 1;
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [groups]);

    async function regenerate(
        group: Group,
        promptHeader: string,
        useReference: boolean,
        sceneCompose: boolean,
        includeAnalysisPrompt: boolean,
    ) {
        const item: GenerateItem = {
            mode: group.mode,
            promptHeader,
            useReference,
            sceneCompose,
            includeAnalysisPrompt,
            ...(group.mode === "custom" ? { label: group.label } : {}),
        };
        setRegenBusy((p) => ({ ...p, [group.key]: true }));
        setRegenError((p) => {
            const { [group.key]: _omit, ...rest } = p;
            return rest;
        });
        try {
            await generate(sessionId, [item]);
            const fresh = await getSession(sessionId);
            setSession(fresh);
        } catch (err) {
            const msg =
                err instanceof ApiError
                    ? `재생성 실패 (${err.status}): ${JSON.stringify(err.detail)}`
                    : err instanceof Error
                      ? err.message
                      : String(err);
            setRegenError((p) => ({ ...p, [group.key]: msg }));
        } finally {
            setRegenBusy((p) => ({ ...p, [group.key]: false }));
        }
    }

    if (error)
        return <div className="max-w-2xl mx-auto p-10 text-red-700">{error}</div>;
    if (!session)
        return (
            <div className="max-w-2xl mx-auto p-10 flex items-center gap-2 text-slate-500">
                <Spinner /> 로딩 중…
            </div>
        );

    return (
        <div className="max-w-screen-2xl mx-auto px-4">
            <StepIndicator current={4} />

            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">생성 결과</h1>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">세션 {sessionId.slice(0, 12)}…</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigate(`/sessions/${sessionId}/generate`)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        컷 추가 생성
                    </button>
                    <button
                        onClick={() => navigate("/")}
                        className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition"
                    >
                        새 세션
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Input column — sticky on large screens */}
                <aside className="lg:col-span-4 xl:col-span-3 space-y-3 lg:sticky lg:top-20 self-start">
                    {session.inputImageUrl && (
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="bg-slate-100">
                                <img src={session.inputImageUrl} alt="원본 입력" className="w-full object-contain max-h-[460px]" />
                            </div>
                            <div className="p-3 flex items-center justify-between">
                                <div>
                                    <div className="text-xs uppercase tracking-wide text-slate-400">input</div>
                                    <div className="text-sm font-medium text-slate-700">원본 입력</div>
                                </div>
                                <a href={session.inputImageUrl} download className="text-xs text-slate-500 hover:text-slate-900 underline">
                                    다운로드
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Analysis prompt — directly below input image, vertical */}
                    {session.promptMd && (
                        <details className="bg-white rounded-2xl border border-slate-200 shadow-sm group">
                            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700 flex items-center gap-2">
                                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                분석 프롬프트 보기
                            </summary>
                            <pre className="px-4 pb-4 text-xs whitespace-pre-wrap font-mono text-slate-500 leading-relaxed max-h-[460px] overflow-auto">
                                {session.promptMd}
                            </pre>
                        </details>
                    )}
                </aside>

                {/* Generated groups */}
                <section className="lg:col-span-8 xl:col-span-9">
                    {groups.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-slate-400 text-sm">
                            아직 생성된 컷이 없습니다.
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {groups.map((g) => (
                            <GroupCard
                                key={g.key}
                                group={g}
                                index={slideIndex[g.key] ?? 0}
                                busy={!!regenBusy[g.key]}
                                error={regenError[g.key]}
                                onPrev={() =>
                                    setSlideIndex((p) => ({
                                        ...p,
                                        [g.key]: Math.max(0, (p[g.key] ?? 0) - 1),
                                    }))
                                }
                                onNext={() =>
                                    setSlideIndex((p) => ({
                                        ...p,
                                        [g.key]: Math.min(g.items.length - 1, (p[g.key] ?? 0) + 1),
                                    }))
                                }
                                onRegenerate={(header, useRef, sceneCompose, includeAnalysis) =>
                                    regenerate(g, header, useRef, sceneCompose, includeAnalysis)
                                }
                            />
                        ))}
                    </div>
                </section>
            </div>

            <div className="h-12" />
        </div>
    );
}

// ---- Subcomponents -------------------------------------------------------

function Spinner() {
    return (
        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

interface GroupCardProps {
    group: Group;
    index: number;
    busy: boolean;
    error?: string;
    onPrev: () => void;
    onNext: () => void;
    onRegenerate: (
        promptHeader: string,
        useReference: boolean,
        sceneCompose: boolean,
        includeAnalysisPrompt: boolean,
    ) => void;
}

function GroupCard({ group, index, busy, error, onPrev, onNext, onRegenerate }: GroupCardProps) {
    const safeIndex = Math.min(Math.max(index, 0), group.items.length - 1);
    const current = group.items[safeIndex];
    const total = group.items.length;
    const [editing, setEditing] = useState<boolean>(false);
    const [draftHeader, setDraftHeader] = useState<string>(current.promptHeader);
    const [useReference, setUseReference] = useState<boolean>(true);
    const [sceneCompose, setSceneCompose] = useState<boolean>(group.mode === "lookbook");
    const [includeAnalysisPrompt, setIncludeAnalysisPrompt] = useState<boolean>(true);

    // Reset draft when the visible image changes (slide or new regeneration).
    useEffect(() => {
        setDraftHeader(current.promptHeader);
    }, [current.id]);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            {/* Image with horizontal slide controls */}
            <div className="relative bg-slate-100">
                <div className="aspect-square overflow-hidden">
                    <img
                        src={current.imageUrl}
                        alt={`${group.label} v${safeIndex + 1}`}
                        className="w-full h-full object-cover transition-opacity duration-300"
                    />
                </div>
                {total > 1 && (
                    <>
                        <button
                            type="button"
                            onClick={onPrev}
                            disabled={safeIndex === 0}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-slate-200 shadow flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-30"
                            aria-label="이전 버전"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            type="button"
                            onClick={onNext}
                            disabled={safeIndex === total - 1}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 border border-slate-200 shadow flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-30"
                            aria-label="다음 버전"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                            {group.items.map((it, i) => (
                                <span
                                    key={it.id}
                                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                        i === safeIndex ? "bg-slate-900" : "bg-white/80 ring-1 ring-slate-300"
                                    }`}
                                />
                            ))}
                        </div>
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] font-medium">
                            v{safeIndex + 1}/{total}
                        </div>
                    </>
                )}
            </div>

            <div className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-slate-400">{group.mode}</div>
                    <div className="text-sm font-medium text-slate-700 truncate">{group.label}</div>
                </div>
                <a
                    href={current.imageUrl}
                    download
                    className="text-xs text-slate-500 hover:text-slate-900 underline shrink-0"
                >
                    다운로드
                </a>
            </div>

            {/* Prompt edit + regenerate */}
            <div className="border-t border-slate-200">
                <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    className="w-full px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-900 flex items-center gap-1.5"
                >
                    <svg
                        className={`w-3.5 h-3.5 transition-transform ${editing ? "rotate-90" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    프롬프트 편집 & 재생성
                </button>
                {editing && (
                    <div className="px-4 pb-4 space-y-2">
                        <textarea
                            value={draftHeader}
                            onChange={(e) => setDraftHeader(e.target.value)}
                            rows={6}
                            spellCheck={false}
                            className="w-full font-mono text-xs leading-relaxed border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-slate-900/20 resize-y"
                        />
                        <div className="flex flex-col gap-1.5 text-xs text-slate-600 select-none">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useReference}
                                    onChange={(e) => setUseReference(e.target.checked)}
                                    className="w-3.5 h-3.5"
                                />
                                원본 이미지 첨부 (해제하면 텍스트 프롬프트만으로 생성)
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={sceneCompose}
                                    onChange={(e) => setSceneCompose(e.target.checked)}
                                    className="w-3.5 h-3.5"
                                />
                                장면 재구성 (사람·포즈·배경 합성. 레퍼런스는 "디테일 참고"로만 사용)
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={includeAnalysisPrompt}
                                    onChange={(e) => setIncludeAnalysisPrompt(e.target.checked)}
                                    className="w-3.5 h-3.5"
                                />
                                기존 분석 프롬프트 결합 (해제하면 위 프롬프트만 사용)
                            </label>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => setDraftHeader(current.promptHeader)}
                                disabled={busy || draftHeader === current.promptHeader}
                                className="text-xs text-slate-500 hover:text-slate-900 disabled:opacity-40"
                            >
                                현재 버전 프롬프트로 되돌리기
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    onRegenerate(draftHeader.trim(), useReference, sceneCompose, includeAnalysisPrompt)
                                }
                                disabled={busy || !draftHeader.trim()}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-40"
                            >
                                {busy ? (
                                    <>
                                        <Spinner />
                                        재생성 중…
                                    </>
                                ) : (
                                    "재생성하기"
                                )}
                            </button>
                        </div>
                        {error && (
                            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
                                {error}
                            </div>
                        )}
                        <p className="text-[11px] text-slate-400">
                            재생성 결과는 기존 이미지 다음으로 추가됩니다. 좌우 화살표로 비교할 수 있어요.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
