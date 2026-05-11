import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    ApiError,
    BuiltInMode,
    GenerateItem,
    GenerateJobOut,
    generate,
    getGenerateJob,
    listStyleHeaders,
    StyleHeaderInfo,
} from "../api/client";
import StepIndicator from "../components/StepIndicator";

const MODE_ICONS: Record<BuiltInMode, string> = {
    lookbook: "👤",
    front: "⬜",
    side: "📐",
    back: "🔄",
};

interface BuiltInState {
    mode: BuiltInMode;
    label: string;
    description: string;
    selected: boolean;
    expanded: boolean;
    promptHeader: string;
    defaultHeader: string;
    useReference: boolean;
    sceneCompose: boolean;
    defaultSceneCompose: boolean;
}

interface CustomState {
    key: string; // local id only
    label: string;
    promptHeader: string;
    useReference: boolean;
    sceneCompose: boolean;
}

const MAX_CUSTOM = 4;

function newCustom(): CustomState {
    return {
        key: Math.random().toString(36).slice(2, 10),
        label: "",
        promptHeader: "",
        useReference: true,
        sceneCompose: false,
    };
}

export default function GeneratePage() {
    const { sessionId = "" } = useParams();
    const navigate = useNavigate();

    const [builtins, setBuiltins] = useState<BuiltInState[]>([]);
    const [customs, setCustoms] = useState<CustomState[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [job, setJob] = useState<GenerateJobOut | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const pollTimerRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (pollTimerRef.current !== null) window.clearTimeout(pollTimerRef.current);
    }, []);

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

    useEffect(() => {
        listStyleHeaders().then(
            (rows: StyleHeaderInfo[]) => {
                setBuiltins(
                    rows.map((r) => ({
                        mode: r.mode,
                        label: r.label,
                        description: r.description,
                        selected: true,
                        expanded: false,
                        promptHeader: r.header,
                        defaultHeader: r.header,
                        useReference: r.useReference,
                        sceneCompose: r.sceneCompose,
                        defaultSceneCompose: r.sceneCompose,
                    }))
                );
                setLoaded(true);
            },
            (e) => setError(e instanceof Error ? e.message : String(e))
        );
    }, []);

    function patchBuiltin(mode: BuiltInMode, patch: Partial<BuiltInState>) {
        setBuiltins((prev) => prev.map((b) => (b.mode === mode ? { ...b, ...patch } : b)));
    }

    function patchCustom(key: string, patch: Partial<CustomState>) {
        setCustoms((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    }

    function removeCustom(key: string) {
        setCustoms((prev) => prev.filter((c) => c.key !== key));
    }

    function addCustom() {
        if (customs.length >= MAX_CUSTOM) return;
        setCustoms((prev) => [...prev, newCustom()]);
    }

    function buildItems(): GenerateItem[] {
        const items: GenerateItem[] = [];
        for (const b of builtins) {
            if (!b.selected) continue;
            const headerChanged = b.promptHeader.trim() !== b.defaultHeader.trim();
            const sceneChanged = b.sceneCompose !== b.defaultSceneCompose;
            items.push({
                mode: b.mode,
                ...(headerChanged ? { promptHeader: b.promptHeader.trim() } : {}),
                ...(sceneChanged ? { sceneCompose: b.sceneCompose } : {}),
            });
        }
        for (const c of customs) {
            if (!c.label.trim() || !c.promptHeader.trim()) continue;
            items.push({
                mode: "custom",
                label: c.label.trim(),
                promptHeader: c.promptHeader.trim(),
                useReference: c.useReference,
                sceneCompose: c.sceneCompose,
            });
        }
        return items;
    }

    const items = buildItems();
    const totalCount = items.length;

    async function onGenerate() {
        if (totalCount === 0) return;
        setBusy(true);
        setError(null);
        setJob(null);
        try {
            const initial = await generate(sessionId, items);
            setJob(initial);
            const final = await pollUntilDone(initial.jobId);
            // 모든 컷이 실패한 경우 결과 페이지에 보여줄 게 없으므로 navigate 하지 않고
            // 사용자가 백엔드 로그/에러를 그대로 볼 수 있게 페이지에 머무른다.
            if (final.status === "failed") {
                const firstErr = final.items.find((i) => i.error)?.error;
                setError(`모든 컷 생성에 실패했습니다.${firstErr ? `\n첫 에러: ${firstErr}` : ""}`);
                return;
            }
            navigate(`/sessions/${sessionId}/results`);
        } catch (err) {
            setError(
                err instanceof ApiError
                    ? `요청 실패 (${err.status}): ${JSON.stringify(err.detail)}`
                    : err instanceof Error
                      ? err.message
                      : String(err)
            );
        } finally {
            setBusy(false);
        }
    }

    /**
     * gpt-image-2 호출은 쇷당 1~5분 걸리므로 최대 12분까지 기다리며 3초마다 폴링한다.
     * SWA Linked Backend 게이트웨이가 긴 HTTP 요청을 자르는 문제를 우회하기 위해
     * generate 는 이미 202 + jobId 로 즉시 끊고, 여기서는 GET 만 반복한다.
     */
    async function pollUntilDone(jobId: string): Promise<GenerateJobOut> {
        const start = Date.now();
        const maxMs = 12 * 60 * 1000;
        while (Date.now() - start < maxMs) {
            await new Promise<void>((resolve) => {
                pollTimerRef.current = window.setTimeout(() => resolve(), 3000);
            });
            const cur = await getGenerateJob(sessionId, jobId);
            setJob(cur);
            if (cur.status !== "running") return cur;
        }
        throw new Error("생성 시간이 12분을 넘었습니다. 결과 페이지에서 일부 이미지가 나왔는지 확인해 주세요.");
    }

    return (
        <div className="max-w-screen-2xl mx-auto px-4">
            <StepIndicator current={3} />

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">광고 컷 모드 선택</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        선택한 모드는 병렬로 생성됩니다. 각 카드의 <span className="font-medium">프롬프트 편집</span>을
                        펼쳐서 컷별 스타일을 직접 수정하거나, 하단의 <span className="font-medium">+ 커스텀 컷 추가</span>로
                        원하는 장면을 자유롭게 만들 수 있습니다.
                    </p>
                </div>

                {!loaded && (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Spinner /> 모드 정보 불러오는 중…
                    </div>
                )}

                {/* Built-in modes */}
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {builtins.map((b) => (
                        <BuiltInCard
                            key={b.mode}
                            state={b}
                            icon={MODE_ICONS[b.mode]}
                            onToggleSelect={() => patchBuiltin(b.mode, { selected: !b.selected })}
                            onToggleExpand={() => patchBuiltin(b.mode, { expanded: !b.expanded })}
                            onChangeHeader={(v) => patchBuiltin(b.mode, { promptHeader: v })}
                            onResetHeader={() => patchBuiltin(b.mode, { promptHeader: b.defaultHeader })}
                            onToggleScene={() => patchBuiltin(b.mode, { sceneCompose: !b.sceneCompose })}
                        />
                    ))}
                </div>

                {/* Custom cuts */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-slate-700">
                            커스텀 컷 <span className="text-slate-400 font-normal">({customs.length}/{MAX_CUSTOM})</span>
                        </h2>
                        <button
                            type="button"
                            onClick={addCustom}
                            disabled={customs.length >= MAX_CUSTOM}
                            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700
                                       hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            커스텀 컷 추가
                        </button>
                    </div>
                    {customs.length === 0 && (
                        <p className="text-xs text-slate-400">
                            예) 남자 모델 룩북, 야외 자연광 컷, 디테일 클로즈업 등 — 직접 프롬프트를 작성해 원하는 장면을 만드세요.
                        </p>
                    )}
                    {customs.map((c, idx) => (
                        <CustomCard
                            key={c.key}
                            index={idx + 1}
                            state={c}
                            onChangeLabel={(v) => patchCustom(c.key, { label: v })}
                            onChangeHeader={(v) => patchCustom(c.key, { promptHeader: v })}
                            onToggleReference={() => patchCustom(c.key, { useReference: !c.useReference })}
                            onToggleScene={() => patchCustom(c.key, { sceneCompose: !c.sceneCompose })}
                            onRemove={() => removeCustom(c.key)}
                        />
                    ))}
                </div>

                {busy && (
                    <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm space-y-2">
                        <div className="flex items-center gap-3">
                            <Spinner /> {totalCount}개 컷 생성 중… 컷당 일반적으로 1~5분 소요됩니다 (최대 12분까지 대기).
                            <span className="ml-auto font-mono text-blue-700/80">경과 {formatElapsed(elapsed)}</span>
                        </div>
                        {job && (
                            <ul className="text-xs grid sm:grid-cols-2 gap-1.5 mt-1">
                                {job.items.map((it) => (
                                    <li key={it.tempId} className="flex items-center gap-2">
                                        <span className="inline-flex w-4 h-4 items-center justify-center">
                                            {it.status === "done" && <span className="text-green-600">✓</span>}
                                            {it.status === "failed" && <span className="text-red-600">✕</span>}
                                            {it.status === "running" && <Spinner />}
                                            {it.status === "pending" && <span className="text-blue-400">·</span>}
                                        </span>
                                        <span className="font-medium">{it.label}</span>
                                        <span className="text-blue-500/70">({it.status})</span>
                                        {it.error && <span className="text-red-600 truncate max-w-[14rem]" title={it.error}>{it.error}</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {job && job.logs && job.logs.length > 0 && (
                            <details open className="mt-2">
                                <summary className="cursor-pointer text-[11px] font-medium text-blue-700/80">
                                    백엔드 로그 ({job.logs.length})
                                </summary>
                                <div className="mt-1 max-h-48 overflow-auto rounded-md bg-blue-950/90 text-blue-50 font-mono text-[11px] leading-relaxed p-2">
                                    {job.logs.map((entry, i) => (
                                        <div key={`${entry.ts}-${i}`} className="whitespace-pre-wrap">
                                            <span className="text-blue-300/70">[{new Date(entry.ts).toLocaleTimeString()}]</span>
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

            {error && (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm whitespace-pre-wrap">
                    {error}
                </div>
            )}

            <div className="flex flex-col sm:flex-row sm:justify-between gap-3 mt-6 mb-8">
                <button
                    onClick={() => navigate(`/sessions/${sessionId}/review`)}
                    className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    이전
                </button>
                <button
                    onClick={onGenerate}
                    disabled={busy || totalCount === 0}
                    className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium
                               hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                    {busy ? (
                        <>
                            <Spinner /> 생성 중…
                        </>
                    ) : (
                        `${totalCount}컷 생성`
                    )}
                </button>
            </div>
        </div>
    );
}

// ---- Subcomponents --------------------------------------------------------

function formatElapsed(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Spinner() {
    return (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

interface BuiltInCardProps {
    state: BuiltInState;
    icon: string;
    onToggleSelect: () => void;
    onToggleExpand: () => void;
    onChangeHeader: (v: string) => void;
    onResetHeader: () => void;
    onToggleScene: () => void;
}

function BuiltInCard({
    state,
    icon,
    onToggleSelect,
    onToggleExpand,
    onChangeHeader,
    onResetHeader,
    onToggleScene,
}: BuiltInCardProps) {
    const on = state.selected;
    const dirty = state.promptHeader.trim() !== state.defaultHeader.trim();
    return (
        <div
            className={`rounded-xl border-2 transition-colors ${
                on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
            }`}
        >
            <button
                type="button"
                onClick={onToggleSelect}
                className="w-full text-left p-4 relative"
            >
                <div
                    className={`absolute top-3 right-3 w-5 h-5 rounded-md border-2 flex items-center justify-center ${
                        on ? "border-white bg-white" : "border-slate-300"
                    }`}
                >
                    {on && (
                        <svg className="w-3 h-3 text-slate-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </div>
                <span className="text-lg">{icon}</span>
                <div className="text-xs uppercase tracking-wider mt-2 opacity-60">{state.mode}</div>
                <div className="font-semibold mt-0.5">{state.label}</div>
                <div className="text-sm opacity-60 mt-1">{state.description}</div>
                {dirty && (
                    <div className={`mt-2 text-[11px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                        ${on ? "bg-white/15 text-white" : "bg-amber-100 text-amber-800"}`}>
                        프롬프트 수정됨
                    </div>
                )}
            </button>

            <div className={`border-t ${on ? "border-white/15" : "border-slate-200"}`}>
                <button
                    type="button"
                    onClick={onToggleExpand}
                    className={`w-full flex items-center justify-between px-4 py-2 text-xs font-medium ${
                        on ? "text-white/80 hover:text-white" : "text-slate-500 hover:text-slate-900"
                    }`}
                >
                    <span className="flex items-center gap-1.5">
                        <svg
                            className={`w-3.5 h-3.5 transition-transform ${state.expanded ? "rotate-90" : ""}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        프롬프트 편집
                    </span>
                    {dirty && (
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                                e.stopPropagation();
                                onResetHeader();
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                                on ? "bg-white/15 hover:bg-white/25" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                            }`}
                        >
                            기본값으로 되돌리기
                        </span>
                    )}
                </button>
                {state.expanded && (
                    <div className={`px-4 pb-4 space-y-2 ${on ? "" : ""}`}>
                        <textarea
                            value={state.promptHeader}
                            onChange={(e) => onChangeHeader(e.target.value)}
                            disabled={!on}
                            spellCheck={false}
                            rows={6}
                            className={`w-full text-xs font-mono leading-relaxed rounded-lg p-3 border focus:outline-none focus:ring-2 transition resize-y
                                ${on
                                    ? "bg-slate-800 border-slate-700 text-white focus:ring-white/30"
                                    : "bg-white border-slate-200 text-slate-800 focus:ring-slate-900/20"}`}
                        />
                        <label className={`flex items-center gap-2 text-[11px] cursor-pointer select-none ${on ? "text-white/80" : "text-slate-600"}`}>
                            <input
                                type="checkbox"
                                checked={state.sceneCompose}
                                onChange={onToggleScene}
                                disabled={!on}
                                className="w-3.5 h-3.5"
                            />
                            장면 재구성 (사람·포즈·배경 합성. 켜면 원본 레퍼런스는 "디테일 참고"로 처리됨)
                        </label>
                        {!on && (
                            <p className="mt-1.5 text-[11px] text-slate-400">
                                컷을 활성화해야 수정한 프롬프트가 적용됩니다.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

interface CustomCardProps {
    index: number;
    state: CustomState;
    onChangeLabel: (v: string) => void;
    onChangeHeader: (v: string) => void;
    onToggleReference: () => void;
    onToggleScene: () => void;
    onRemove: () => void;
}

function CustomCard({
    index,
    state,
    onChangeLabel,
    onChangeHeader,
    onToggleReference,
    onToggleScene,
    onRemove,
}: CustomCardProps) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <span className="inline-flex w-6 h-6 rounded-full bg-slate-900 text-white items-center justify-center text-xs">
                        {index}
                    </span>
                    커스텀 컷
                </div>
                <button
                    type="button"
                    onClick={onRemove}
                    className="text-xs text-slate-400 hover:text-red-600"
                >
                    삭제
                </button>
            </div>
            <input
                value={state.label}
                onChange={(e) => onChangeLabel(e.target.value)}
                placeholder="컷 이름 (예: 남자 모델 룩북, 야외 자연광 컷)"
                className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20"
            />
            <textarea
                value={state.promptHeader}
                onChange={(e) => onChangeHeader(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={`예) 1024x1024 정방형, 30대 남성 모델이 자연스러운 데일리 룩으로 상품을 착용한 도시 야외 컷.\n구도/조명/분위기를 자세히 적을수록 결과 안정성이 올라갑니다.`}
                className="w-full font-mono text-xs leading-relaxed border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-slate-900/20 resize-y"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
                <input
                    type="checkbox"
                    checked={state.useReference}
                    onChange={onToggleReference}
                    className="w-3.5 h-3.5"
                />
                원본 이미지를 레퍼런스로 사용 (해제하면 텍스트 프롬프트만으로 생성)
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
                <input
                    type="checkbox"
                    checked={state.sceneCompose}
                    onChange={onToggleScene}
                    className="w-3.5 h-3.5"
                />
                장면 재구성 (사람·포즈·배경 합성. 사람 등장 컷을 만들 때 권장)
            </label>
        </div>
    );
}
