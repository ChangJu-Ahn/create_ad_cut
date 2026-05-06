const STEPS = [
    { num: 1, label: "업로드", desc: "상품 사진" },
    { num: 2, label: "검수", desc: "분석 결과 확인" },
    { num: 3, label: "생성", desc: "모드 선택" },
    { num: 4, label: "결과", desc: "광고 컷 확인" },
] as const;

interface Props {
    current: 1 | 2 | 3 | 4;
}

export default function StepIndicator({ current }: Props) {
    return (
        <nav className="w-full py-6">
            <ol className="flex items-center justify-center gap-0">
                {STEPS.map((step, i) => {
                    const done = step.num < current;
                    const active = step.num === current;
                    return (
                        <li key={step.num} className="flex items-center">
                            {/* connector line before (skip first) */}
                            {i > 0 && (
                                <div
                                    className={`w-10 sm:w-16 h-0.5 ${
                                        step.num <= current ? "bg-slate-900" : "bg-slate-200"
                                    }`}
                                />
                            )}

                            <div className="flex flex-col items-center min-w-[4.5rem]">
                                <div
                                    className={`
                                        flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold
                                        transition-colors
                                        ${active ? "bg-slate-900 text-white ring-4 ring-slate-900/20" : ""}
                                        ${done ? "bg-slate-900 text-white" : ""}
                                        ${!active && !done ? "bg-slate-200 text-slate-500" : ""}
                                    `}
                                >
                                    {done ? (
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        step.num
                                    )}
                                </div>
                                <span
                                    className={`mt-1.5 text-xs font-medium ${
                                        active ? "text-slate-900" : "text-slate-400"
                                    }`}
                                >
                                    {step.label}
                                </span>
                                <span className="text-[10px] text-slate-400 hidden sm:block">
                                    {step.desc}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
