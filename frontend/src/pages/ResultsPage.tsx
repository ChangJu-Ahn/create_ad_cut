import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ApiError,
    GenerateItem,
    GenerateJobLogEntry,
    GenerateJobOut,
    GenerationResult,
    ShotMode,
    generate,
    getGenerateJob,
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
    const [regenStage, setRegenStage] = useState<Record<string, string>>({});
    const [regenLogs, setRegenLogs] = useState<Record<string, GenerateJobLogEntry[]>>({});
    const [dismissedJobId, setDismissedJobId] = useState<string | null>(null);
    const pollTimerRef = useRef<number | null>(null);

    useEffect(() => {
        getSession(sessionId).then(setSession, (e) =>
            setError(e instanceof Error ? e.message : String(e))
        );
    }, [sessionId]);

    const latestJob: GenerateJobOut | null = useMemo(() => {
        if (!session?.jobs?.length) return null;
        return [...session.jobs].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
    }, [session]);

    // 진행 중인 잡이 있으면 3초마다 세션 전체를 다시 가져온다.
    // 백엔드가 generations[]에 결과를 append하기 때문에 이미지 카드도 자동으로 늘어남.
    useEffect(() => {
        if (pollTimerRef.current !== null) {
            window.clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        if (!latestJob || latestJob.status !== "running") return;
        pollTimerRef.current = window.setTimeout(() => {
            getSession(sessionId).then(setSession, () => {});
        }, 3000);
        return () => {
            if (pollTimerRef.current !== null) {
                window.clearTimeout(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [latestJob?.jobId, latestJob?.updatedAt, latestJob?.status, sessionId]);

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
        setRegenStage((p) => ({ ...p, [group.key]: "queued" }));
        setRegenLogs((p) => ({ ...p, [group.key]: [] }));
        setRegenError((p) => {
            const { [group.key]: _omit, ...rest } = p;
            return rest;
        });
        try {
            // 202 + jobId 로 즉시 끊고, 완료될 때까지 폴링.
            // gpt-image-2 호출은 1~5분이므로 이 패턴이 동기 요청보다 안전함.
            const initial = await generate(sessionId, [item]);
            setRegenStage((p) => ({ ...p, [group.key]: initial.items[0]?.status ?? "pending" }));
            setRegenLogs((p) => ({ ...p, [group.key]: initial.logs ?? [] }));
            const start = Date.now();
            const maxMs = 12 * 60 * 1000;
            // eslint-disable-next-line no-constant-condition
            while (true) {
                if (Date.now() - start > maxMs) {
                    throw new Error("재생성 시간이 12분을 넘었습니다.");
                }
                await new Promise<void>((r) => setTimeout(r, 3000));
                const cur = await getGenerateJob(sessionId, initial.jobId);
                setRegenStage((p) => ({ ...p, [group.key]: cur.items[0]?.status ?? cur.status }));
                setRegenLogs((p) => ({ ...p, [group.key]: cur.logs ?? [] }));
                if (cur.status !== "running") {
                    if (cur.items.some((i) => i.status === "failed")) {
                        const msg = cur.items.find((i) => i.status === "failed")?.error ?? "재생성 실패";
                        throw new Error(msg);
                    }
                    break;
                }
            }
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
            setRegenStage((p) => {
                const { [group.key]: _omit, ...rest } = p;
                return rest;
            });
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

            {latestJob && latestJob.jobId !== dismissedJobId && (
                <JobBanner
                    job={latestJob}
                    onDismiss={
                        latestJob.status === "running"
                            ? undefined
                            : () => setDismissedJobId(latestJob.jobId)
                    }
                />
            )}

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
                                stage={regenStage[g.key]}
                                logs={regenLogs[g.key]}
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

function formatElapsed(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Spinner() {
    return (
        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

interface JobBannerProps {
    job: GenerateJobOut;
    onDismiss?: () => void;
}

function JobBanner({ job, onDismiss }: JobBannerProps) {
    const isRunning = job.status === "running";
    const isFailed = job.status === "failed";
    const isPartial = job.status === "partial";
    const tone = isRunning
        ? "bg-blue-50 border-blue-200 text-blue-800"
        : isFailed
          ? "bg-red-50 border-red-200 text-red-800"
          : isPartial
            ? "bg-amber-50 border-amber-200 text-amber-900"
            : "bg-emerald-50 border-emerald-200 text-emerald-900";
    const doneCount = job.items.filter((i) => i.status === "done").length;
    const failedCount = job.items.filter((i) => i.status === "failed").length;
    const totalCount = job.items.length;
    const headline = isRunning
        ? `${totalCount}개 컷 생성 중… (${doneCount}/${totalCount} 완료, 컷당 1~5분 소요)`
        : isFailed
          ? `생성 실패 — ${failedCount}/${totalCount}개 컷이 모두 실패했습니다.`
          : isPartial
            ? `부분 완료 — ${doneCount}/${totalCount}개 성공, ${failedCount}개 실패.`
            : `생성 완료 — ${doneCount}/${totalCount}개 컷.`;
    return (
        <div className={`mb-4 p-4 rounded-xl border text-sm space-y-2 ${tone}`}>
            <div className="flex items-center gap-3">
                {isRunning && <Spinner />}
                <span className="font-medium">{headline}</span>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        className="ml-auto text-xs underline opacity-70 hover:opacity-100"
                    >
                        닫기
                    </button>
                )}
            </div>
            <ul className="text-xs grid sm:grid-cols-2 gap-1.5 mt-1">
                {job.items.map((it) => (
                    <li key={it.tempId} className="flex items-center gap-2">
                        <span className="inline-flex w-4 h-4 items-center justify-center">
                            {it.status === "done" && <span className="text-green-600">✓</span>}
                            {it.status === "failed" && <span className="text-red-600">✕</span>}
                            {it.status === "running" && <Spinner />}
                            {it.status === "pending" && <span className="opacity-60">·</span>}
                        </span>
                        <span className="font-medium">{it.label}</span>
                        <span className="opacity-70">({it.status})</span>
                        {it.error && (
                            <span className="text-red-600 truncate max-w-[20rem]" title={it.error}>
                                {it.error}
                            </span>
                        )}
                    </li>
                ))}
            </ul>
            {job.logs && job.logs.length > 0 && (
                <details className="mt-2" open={isFailed}>
                    <summary className="cursor-pointer text-[11px] font-medium opacity-80">
                        백엔드 로그 ({job.logs.length})
                    </summary>
                    <div className="mt-1 max-h-48 overflow-auto rounded-md bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed p-2">
                        {job.logs.map((entry, i) => (
                            <div key={`${entry.ts}-${i}`} className="whitespace-pre-wrap">
                                <span className="text-slate-400">[{new Date(entry.ts).toLocaleTimeString()}]</span>
                                {entry.label ? <span className="text-amber-300"> {entry.label}</span> : null}
                                <span> {entry.message}</span>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

interface GroupCardProps {
    group: Group;
    index: number;
    busy: boolean;
    stage?: string;
    logs?: GenerateJobLogEntry[];
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

function GroupCard({ group, index, busy, stage, logs, error, onPrev, onNext, onRegenerate }: GroupCardProps) {
    const safeIndex = Math.min(Math.max(index, 0), group.items.length - 1);
    const current = group.items[safeIndex];
    const total = group.items.length;
    const [editing, setEditing] = useState<boolean>(false);
    const [draftHeader, setDraftHeader] = useState<string>(current.promptHeader);
    const [useReference, setUseReference] = useState<boolean>(true);
    const [sceneCompose, setSceneCompose] = useState<boolean>(group.mode === "lookbook");
    const [includeAnalysisPrompt, setIncludeAnalysisPrompt] = useState<boolean>(true);
    const [elapsed, setElapsed] = useState<number>(0);

    // Reset draft when the visible image changes (slide or new regeneration).
    useEffect(() => {
        setDraftHeader(current.promptHeader);
    }, [current.id]);

    // Tick an elapsed counter while the regenerate request is in flight so the user can see progress.
    useEffect(() => {
        if (!busy) {
            setElapsed(0);
            return;
        }
        const startedAt = Date.now();
        setElapsed(0);
        const id = window.setInterval(() => {
            setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(id);
    }, [busy]);

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
                {busy && (
                    <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 text-white">
                        <Spinner />
                        <div className="text-sm font-medium">재생성 중…</div>
                        <div className="font-mono text-xs opacity-80">경과 {formatElapsed(elapsed)}</div>
                        <div className="text-[11px] opacity-80">백엔드 상태: <span className="font-mono">{stage ?? "connecting"}</span></div>
                        <div className="text-[11px] opacity-70">일반적으로 1~5분 소요</div>
                    </div>
                )}
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
                                사람 모델 합성 (체크하면 모델이 착용·소지한 장면을 새로 그림)
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
                                        재생성 중… {formatElapsed(elapsed)}
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
                        {(busy || error) && logs && logs.length > 0 && (
                            <details open className="mt-1">
                                <summary className="cursor-pointer text-[11px] font-medium text-slate-500">
                                    백엔드 로그 ({logs.length})
                                </summary>
                                <div className="mt-1 max-h-40 overflow-auto rounded-md bg-slate-900 text-slate-100 font-mono text-[11px] leading-relaxed p-2">
                                    {logs.map((entry, i) => (
                                        <div key={`${entry.ts}-${i}`} className="whitespace-pre-wrap">
                                            <span className="text-slate-400">[{new Date(entry.ts).toLocaleTimeString()}]</span>
                                            {entry.label ? <span className="text-amber-300"> {entry.label}</span> : null}
                                            <span> {entry.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
