import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    ApiError,
    BoardPostListItem,
    createBoardPost,
    listBoardPosts,
} from "../api/client";

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

function describeError(err: unknown): string {
    if (err instanceof ApiError) {
        return `요청 실패 (${err.status}): ${
            typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
        }`;
    }
    if (err instanceof Error) return err.message;
    return String(err);
}

export default function BoardListPage() {
    const [items, setItems] = useState<BoardPostListItem[] | null>(null);
    const [listError, setListError] = useState<string | null>(null);

    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [author, setAuthor] = useState("");
    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setListError(null);
        try {
            const res = await listBoardPosts();
            setItems(res.items);
        } catch (err) {
            setListError(describeError(err));
            setItems([]); // keep UI usable on partial failure
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        if (!title.trim() || !body.trim()) return;
        setBusy(true);
        setFormError(null);
        try {
            await createBoardPost({
                title: title.trim(),
                body,
                author: author.trim() || undefined,
            });
            setTitle("");
            setBody("");
            setAuthor("");
            await refresh();
        } catch (err) {
            setFormError(describeError(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">게시판</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        작성된 게시글을 빠르게 확인하고 새 글을 남겨 보세요.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    className="text-sm text-slate-500 hover:text-slate-900 transition"
                >
                    새로고침
                </button>
            </div>

            {/* Compose */}
            <form
                onSubmit={onSubmit}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
            >
                <h2 className="text-base font-semibold text-slate-900">새 글 작성</h2>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        제목 <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={200}
                        required
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        내용 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        rows={5}
                        required
                        className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        작성자 <span className="text-slate-400 font-normal">(선택)</span>
                    </label>
                    <input
                        type="text"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        maxLength={80}
                        className="w-full border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                    />
                </div>

                {formError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 p-3 text-sm">
                        {formError}
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={busy || !title.trim() || !body.trim()}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                        {busy ? "등록 중…" : "글 작성"}
                    </button>
                </div>
            </form>

            {/* List */}
            <section className="space-y-3">
                <h2 className="text-base font-semibold text-slate-900">게시글 목록</h2>

                {listError && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 p-4 text-sm">
                        목록을 불러오는 중 문제가 발생했습니다: {listError}
                    </div>
                )}

                {items === null ? (
                    <div className="text-sm text-slate-400 py-6 text-center">불러오는 중…</div>
                ) : items.length === 0 && !listError ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                        아직 작성된 게시글이 없습니다. 첫 글을 남겨 보세요.
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-200 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        {items.map((p) => (
                            <li key={p.postId}>
                                <Link
                                    to={`/board/${p.postId}`}
                                    className="block px-5 py-4 hover:bg-slate-50 transition"
                                >
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="font-medium text-slate-900 truncate">
                                            {p.title}
                                        </span>
                                        <span className="text-xs text-slate-400 shrink-0">
                                            {formatDate(p.createdAt)}
                                        </span>
                                    </div>
                                    {p.excerpt && (
                                        <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                                            {p.excerpt}
                                        </p>
                                    )}
                                    {p.author && (
                                        <p className="text-xs text-slate-400 mt-1">{p.author}</p>
                                    )}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
