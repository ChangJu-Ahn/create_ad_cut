interface Props {
    value: string;
    onChange: (v: string) => void;
}

export default function PromptEditor({ value, onChange }: Props) {
    return (
        <div className="space-y-1.5">
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                className="w-full h-[480px] font-mono text-sm border border-slate-200 rounded-xl p-4 leading-relaxed
                           bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition resize-none"
            />
            <div className="text-xs text-slate-400 text-right">{value.length.toLocaleString()} 자</div>
        </div>
    );
}
