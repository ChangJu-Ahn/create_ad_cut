import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PromptEditor from "../components/PromptEditor";
import StepIndicator from "../components/StepIndicator";
import { ApiError, getSession, updatePrompt } from "../api/client";

export default function ReviewPage() {
    const { sessionId = "" } = useParams();
    const navigate = useNavigate();
    const [promptMd, setPromptMd] = useState<string>("");
    const [inputUrl, setInputUrl] = useState<string>("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const cached = sessionStorage.getItem(`cac.session.${sessionId}`);
        if (cached) {
            const v = JSON.parse(cached);
            setPromptMd(v.promptMd ?? "");
            setInputUrl(v.inputImageUrl ?? "");
            return;
        }
        getSession(sessionId).then(
            (s) => {
                setPromptMd(s.promptMd ?? "");
                setInputUrl(s.inputImageUrl ?? "");
            },
            (e) => setError(e instanceof Error ? e.message : String(e))
        );
    }, [sessionId]);

    async function onNext() {
        setBusy(true);
        setError(null);
        try {
            await updatePrompt(sessionId, promptMd);
            sessionStorage.setItem(
                `cac.session.${sessionId}`,
                JSON.stringify({ promptMd, inputImageUrl: inputUrl })
            );
            navigate(`/sessions/${sessionId}/generate`);
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

    return (
        <div className="max-w-screen-2xl mx-auto px-4">
            <StepIndicator current={2} />

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">분석 결과 검수</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        좌우 비대칭 · 색상 순서 · 가려진 부위를 직접 확인하고 필요한 부분만 수정하세요.
                    </p>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                    {/* Input image */}
                    <div>
                        <h2 className="text-sm font-medium text-slate-700 mb-2">입력 이미지</h2>
                        {inputUrl ? (
                            <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                                <img src={inputUrl} alt="원본 입력" className="w-full object-contain max-h-[480px]" />
                            </div>
                        ) : (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 h-48 flex items-center justify-center text-slate-400 text-sm">
                                이미지 없음
                            </div>
                        )}
                    </div>

                    {/* Prompt editor */}
                    <div>
                        <h2 className="text-sm font-medium text-slate-700 mb-2">
                            상품 분석 프롬프트 <span className="text-slate-400 font-normal">(수정 가능)</span>
                        </h2>
                        <PromptEditor value={promptMd} onChange={setPromptMd} />
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mt-4 rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">
                    {error}
                </div>
            )}

            {/* Actions */}
            <div className="flex justify-between mt-6 mb-8">
                <button
                    onClick={() => navigate("/")}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    다시 업로드
                </button>
                <button
                    onClick={onNext}
                    disabled={busy || !promptMd.trim()}
                    className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium
                               hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                    {busy ? "저장 중…" : "다음: 모드 선택"}
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
