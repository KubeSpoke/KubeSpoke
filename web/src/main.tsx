import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ksTheme } from "./theme/ksTheme";
import "./index.css";

// 主题唯一来源：ksTheme（antd token）+ index.css（@theme 令牌与 .ks-* 覆盖）
function Root() {
  return (
    <StrictMode>
      <ConfigProvider
        locale={zhCN}
        theme={ksTheme}
        button={{ autoInsertSpace: false }}
      >
        <AntApp>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
