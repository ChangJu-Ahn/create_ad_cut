import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { analyze, ApiError, createSession } from "../api/client";
import StepIndicator from "../components/StepIndicator";

export default function UploadPage() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [detailNote, setDetailNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    function onFileChange(f: File | null) {
        setFile(f);
        if (f) {
            const url = URL.createObjectURL(f);
            setPreview(url);
        } else {
            setPreview(null);
        }
    }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        setError(null);
        try {
            const session = await createSession();
            const result = await analyze(session.sessionId, file, detailNote || undefined);
            sessionStorage.setItem(
                `cac.session.${result.sessionId}`,
                JSON.stringify({
                    promptMd: result.promptMd,
                    inputImageUrl: result.inputImageUrl,
                })
            );
            navigate(`/sessions/${result.sessionId}/review`);
        } catch (err) {
            const msg =
                err instanceof ApiError
                    ? `요청 실패 (${err.status}): ${JSON.stringify(err.detail)}`
                    : err instanceof Error
                      ? err.message
                      : String(err);
            setError(msg);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="max-w-3xl mx-auto px-4">
            <StepIndicator current={1} />

            <form onSubmit={onSubmit} className="space-y-6">
                {/* Card */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h1 className="text-xl font-bold text-slate-900">상품 사진 업로드</h1>
                            <p className="text-sm text-slate-500 mt-1">
                                PNG / JPEG / WEBP, 최대 10 MB. 업로드하면 GPT-5.x 가 상품을 분석합니다.
                            </p>
                        </div>
                        <Link
                            to="/gallery"
                            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-900 hover:text-white transition"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                            </svg>
                            생성 이력 보기
                        </Link>
                    </div>

                    {/* Drop zone */}
                    <div
                        onClick={() => inputRef.current?.click()}
                        className={`
                            relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
                            transition-colors
                            ${file ? "border-slate-300 bg-slate-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"}
                        `}
                    >
                        {preview ? (
                            <div className="flex flex-col items-center gap-3">
                                <img
                                    src={preview}
                                    alt="미리보기"
                                    className="max-h-52 rounded-lg object-contain"
                                />
                                <div>
                                    <div className="text-sm font-medium text-slate-700">{file?.name}</div>
                                    <div className="text-xs text-slate-400">
                                        {file && (file.size / 1024).toFixed(1)} KB &middot; {file?.type}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="py-8">
                                <svg className="mx-auto w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                </svg>
                                <p className="mt-3 text-sm text-slate-500">클릭하여 이미지를 선택하세요</p>
                                <p className="mt-1 text-xs text-slate-400">PNG, JPEG, WEBP</p>
                            </div>
                        )}
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                        />
                    </div>

                    {/* Detail note */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            추가 검수 노트 <span className="text-slate-400 font-normal">(선택)</span>
                        </label>
                        <textarea
                            value={detailNote}
                            onChange={(e) => setDetailNote(e.target.value)}
                            rows={3}
                            placeholder="예: 이미지 기준 왼쪽 소매 커프스에 하늘색+검정 띠가 있다."
                            className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                        />
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">
                        {error}
                    </div>
                )}

                {/* Action */}
                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={!file || busy}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-medium text-sm
                                   hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                        {busy && (
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                            </svg>
                        )}
                        {busy ? "분석 중…" : "분석 시작"}
                    </button>
                </div>
            </form>
        </div>
    );
}
