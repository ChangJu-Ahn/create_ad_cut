import { useEffect, useState } from "react";
import { ApiError, BoardPost, createPost, listPosts } from "../api/client";

export default function BoardPage() {
    const [author, setAuthor] = useState("");
    const [content, setContent] = useState("");
    const [posts, setPosts] = useState<BoardPost[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    async function refresh() {
        const items = await listPosts(50);
        setPosts(items);
    }

    useEffect(() => {
        refresh()
            .catch((err) => {
                const msg =
                    err instanceof ApiError
                        ? `요청 실패 (${err.status}): ${JSON.stringify(err.detail)}`
                        : err instanceof Error
                          ? err.message
                          : String(err);
                setError(msg);
            })
            .finally(() => setLoading(false));
    }, []);

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await createPost(author, content);
            setContent("");
            await refresh();
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
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-4">
                <h1 className="text-xl font-bold text-slate-900">익명 게시판</h1>
                <form onSubmit={onSubmit} className="space-y-3">
                    <input
                        data-testid="post-author"
                        value={author}
                        onChange={(e) => setAuthor(e.target.value)}
                        maxLength={50}
                        placeholder="작성자 (비우면 익명)"
                        className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                    />
                    <textarea
                        data-testid="post-content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        maxLength={1000}
                        rows={4}
                        placeholder="내용을 입력하세요 (최대 1000자)"
                        className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-400 transition"
                    />
                    <div className="flex justify-end">
                        <button
                            data-testid="post-submit"
                            type="submit"
                            disabled={busy}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                        >
                            {busy ? "등록 중…" : "등록"}
                        </button>
                    </div>
                </form>
            </div>

            {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">{error}</div>}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">최신 글</h2>
                <div data-testid="post-list" className="space-y-3">
                    {!loading && posts.length === 0 && <div className="text-sm text-slate-500">아직 글이 없습니다.</div>}
                    {posts.map((post) => (
                        <article key={post.id} data-testid="post-item" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-medium text-slate-900">{post.author}</div>
                            <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{post.content}</p>
                            <div className="mt-2 text-xs text-slate-400">{new Date(post.createdAt).toLocaleString()}</div>
                        </article>
                    ))}
                </div>
            </div>
        </div>
    );
}
