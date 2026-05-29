import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";

const appName = (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() || "create-ad-cut";
document.title = `${appName} · Azure 광고 컷 자동 생성`;

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
    </React.StrictMode>
);
