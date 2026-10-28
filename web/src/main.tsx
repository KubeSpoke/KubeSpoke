import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "antd/dist/reset.css";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { useThemeStore } from "./store/useThemeStore";
import { buildKsTheme } from "./theme/ksTheme";
import "./index.css";

// 主题唯一来源：buildKsTheme(mode)（antd token）+ index.css（--ks-* 变量与 .ks-* 覆盖）
function Root() {
  const mode = useThemeStore((s) => s.mode);

  /** 把模式同步到 <html>：CSS 变量与 color-scheme 都挂在它上面，antd 弹层也读它 */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", mode);
    root.style.colorScheme = mode;
  }, [mode]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={buildKsTheme(mode)}
      button={{ autoInsertSpace: false }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
