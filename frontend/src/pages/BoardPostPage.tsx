import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, BoardPost, getBoardPost } from "../api/client";

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

export default function BoardPostPage() {
    const { postId } = useParams<{ postId: string }>();
    const [post, setPost] = useState<BoardPost | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        if (!postId) return;
        let cancelled = false;
        setError(null);
        setNotFound(false);
        setPost(null);
        getBoardPost(postId)
            .then((p) => {
                if (!cancelled) setPost(p);
            })
            .catch((err) => {
                if (cancelled) return;
                if (err instanceof ApiError && err.status === 404) {
                    setNotFound(true);
                } else if (err instanceof ApiError) {
                    setError(
                        `요청 실패 (${err.status}): ${
                            typeof err.detail === "string"
                                ? err.detail
                                : JSON.stringify(err.detail)
                        }`
                    );
                } else if (err instanceof Error) {
                    setError(err.message);
                } else {
                    setError(String(err));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [postId]);

    return (
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            <div>
                <Link to="/board" className="text-sm text-slate-500 hover:text-slate-900 transition">
                    ← 게시판으로
                </Link>
            </div>

            {notFound ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                    존재하지 않는 게시글입니다.
                </div>
            ) : error ? (
                <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 p-4 text-sm">
                    {error}
                </div>
            ) : post === null ? (
                <div className="text-sm text-slate-400 py-6 text-center">불러오는 중…</div>
            ) : (
                <article className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-4">
                    <header className="space-y-1">
                        <h1 className="text-2xl font-bold text-slate-900 break-words">
                            {post.title}
                        </h1>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                            {post.author && <span>{post.author}</span>}
                            <span>{formatDate(post.createdAt)}</span>
                        </div>
                    </header>
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap text-slate-700">
                        {post.body}
                    </div>
                </article>
            )}
        </div>
    );
}
