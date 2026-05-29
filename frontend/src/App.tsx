import { Link, Route, Routes } from "react-router-dom";
import GeneratePage from "./pages/GeneratePage";
import ResultsPage from "./pages/ResultsPage";
import ReviewPage from "./pages/ReviewPage";
import UploadPage from "./pages/UploadPage";

export default function App() {
    const appName = (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() || "create-ad-cut";

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
                <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                    <Link to="/" className="flex items-center gap-2 font-bold text-slate-900 tracking-tight">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-xs">AI</span>
                        {appName}
                    </Link>
                    <nav className="flex items-center gap-2">
                        <Link
                            to="/"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            새로 만들기
                        </Link>
                    </nav>
                </div>
            </header>

            {/* Page content */}
            <main className="flex-1">
                <Routes>
                    <Route path="/" element={<UploadPage />} />
                    <Route path="/sessions/:sessionId/review" element={<ReviewPage />} />
                    <Route path="/sessions/:sessionId/generate" element={<GeneratePage />} />
                    <Route path="/sessions/:sessionId/results" element={<ResultsPage />} />
                </Routes>
            </main>

            {/* Footer */}
            <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
                Azure OpenAI &middot; gpt-5.x &middot; gpt-image-2 &middot; Container Apps &middot; Static Web Apps
                <span className="mx-2">&middot;</span>
                <span title="Agentic DevOps demo">Agentic DevOps</span>
            </footer>
        </div>
    );
}
