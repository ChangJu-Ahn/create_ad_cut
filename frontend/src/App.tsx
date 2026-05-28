import { Link, Route, Routes } from "react-router-dom";
import GalleryPage from "./pages/GalleryPage";
import GeneratePage from "./pages/GeneratePage";
import ResultsPage from "./pages/ResultsPage";
import ReviewPage from "./pages/ReviewPage";
import UploadPage from "./pages/UploadPage";

export default function App() {
    const appName = import.meta.env.VITE_APP_NAME ?? "create-ad-cut";

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
                <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2 font-bold text-slate-900 tracking-tight">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-xs">AI</span>
                        {appName}
                    </Link>
                    <Link
                        to="/gallery"
                        data-testid="nav-gallery"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition shadow-sm"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4.5h7v7H3v-7zm11 0h7v4h-7v-4zm0 7h7v9h-7v-9zm-11 4h7v5H3v-5z" />
                        </svg>
                        생성 이력
                    </Link>
                </div>
            </header>

            {/* Page content */}
            <main className="flex-1">
                <Routes>
                    <Route path="/" element={<UploadPage />} />
                    <Route path="/sessions/:sessionId/review" element={<ReviewPage />} />
                    <Route path="/sessions/:sessionId/generate" element={<GeneratePage />} />
                    <Route path="/sessions/:sessionId/results" element={<ResultsPage />} />
                    <Route path="/gallery" element={<GalleryPage />} />
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
