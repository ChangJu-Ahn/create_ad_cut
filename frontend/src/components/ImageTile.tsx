import type { GenerationResult } from "../api/client";

export default function ImageTile({ title, src, mode }: { title: string; src: string; mode?: GenerationResult["mode"] }) {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="aspect-square bg-slate-100">
                {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                <img src={src} alt={title} className="w-full h-full object-cover" />
            </div>
            <div className="p-3 flex items-center justify-between">
                <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                        {mode ?? "input"}
                    </div>
                    <div className="text-sm font-medium">{title}</div>
                </div>
                <a
                    href={src}
                    download
                    className="text-xs text-slate-600 hover:text-slate-900 underline"
                >
                    다운로드
                </a>
            </div>
        </div>
    );
}
