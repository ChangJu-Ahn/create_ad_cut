import { Link, NavLink, Route, Routes } from "react-router-dom";
import BoardListPage from "./pages/BoardListPage";
import BoardPostPage from "./pages/BoardPostPage";
import GeneratePage from "./pages/GeneratePage";
import ResultsPage from "./pages/ResultsPage";
import ReviewPage from "./pages/ReviewPage";
import UploadPage from "./pages/UploadPage";

export default function App() {
    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Top bar */}
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur">
                <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2 font-bold text-slate-900 tracking-tight">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-xs">AI</span>
                        create-ad-cut
                    </Link>
                    <nav className="flex items-center gap-4 text-sm">
                        <NavLink
                            to="/board"
                            className={({ isActive }) =>
                                `transition ${isActive ? "text-slate-900 font-semibold" : "text-slate-500 hover:text-slate-900"}`
                            }
                        >
                            게시판
                        </NavLink>
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
                    <Route path="/board" element={<BoardListPage />} />
                    <Route path="/board/:postId" element={<BoardPostPage />} />
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
