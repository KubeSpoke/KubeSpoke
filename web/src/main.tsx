import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ksTheme } from "./theme/ksTheme";
import "./index.css";
import useLobeTheme from "./theme/theme";

// useLobeTheme 是 Hook（内部调用 useMemo），必须在组件函数体内调用，
// 不能在模块顶层执行，否则会触发 "Invalid hook call"。
function Root() {
  const configProps = useLobeTheme();
  return (
    <StrictMode>
      <ConfigProvider
        locale={zhCN}
        theme={ksTheme}
        {...configProps}
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
