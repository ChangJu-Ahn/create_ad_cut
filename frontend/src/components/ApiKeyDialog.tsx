import { useEffect, useState } from "react";
import { getApiKey, setApiKey } from "../api/client";

export default function ApiKeyDialog() {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(getApiKey());

    useEffect(() => {
        if (!getApiKey()) setOpen(true);
    }, []);

    function save() {
        setApiKey(value.trim());
        setOpen(false);
    }

    return (
        <>
            <button
                onClick={() => {
                    setValue(getApiKey());
                    setOpen(true);
                }}
                className="text-xs text-slate-500 hover:text-slate-900 underline"
            >
                API Key 설정
            </button>

            {open && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
                        <h2 className="text-lg font-bold mb-2">Backend API Key</h2>
                        <p className="text-sm text-slate-600 mb-4">
                            모든 요청의 <code>X-API-Key</code> 헤더로 전송됩니다. 키는
                            브라우저 localStorage에만 저장됩니다.
                        </p>
                        <input
                            type="password"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder="BACKEND_API_KEY"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setOpen(false)}
                                className="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100"
                            >
                                취소
                            </button>
                            <button
                                onClick={save}
                                disabled={!value.trim()}
                                className="px-4 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50"
                            >
                                저장
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
