# Flash Recorder

一个基于 Tauri 2 + React + TypeScript + Vite 的轻量录屏与编辑工具，支持 Windows 打包与桌面运行。

## 技术栈
- 前端：React + TypeScript + Vite
- 桌面：Tauri 2（Rust）
- UI：Headless UI（Switch、Listbox、Dialog、Transition 等）
- 打包：MSI（WiX），可选 NSIS

## 开发与构建
- 启动开发（推荐）
  - `pnpm tauri dev`
  - Tauri 将启动前端 dev 服务器（默认 1420 端口）并运行原生进程
- 构建安装包
  - `pnpm tauri build`
  - 产物输出目录：`src-tauri/target/release/bundle/`
  - 如果 NSIS 下载验证失败，可将 `tauri.conf.json` 中 `bundle.targets` 临时改为 `["msi"]`

## 主要页面
- 主页面（录制控制）：`index.html`
- 小窗页面（录制悬浮窗）：`mini.html`
- 编辑页面（预览与导出）：`edit.html`
  - 预览缩放（Zoom In/Out）
    - 鼠标滚轮：向上放大、向下缩小（范围 100%–300%，步进 10%）
    - 双击预览区域：重置为 100%
    - 底部控制：± 按钮与滑块同步控制缩放

## 功能概览
- 录制模式：屏幕、窗口、区域
- 设备选择：摄像头、麦克风（FFmpeg dshow 列举）
- 编辑预览：缩放、拖动时间轴、镜像/模糊相机叠层、相机位置与形状
- 导出能力：使用 FFmpeg 进行转码导出，进度事件通过 Tauri emit 上报
- 打开文件夹：在 Windows 上调用系统 Explorer 打开导出目录

## Windows 打包要点
- 安装包格式：MSI（WiX），可选 NSIS（可能需要联网下载依赖）
- WebView2：`downloadBootstrapper` 模式自动安装，支持静默
- 资源目录：`src-tauri/ffmpeg/`（打包时会随应用发布，可按需替换二进制）
- 快捷方式：通过 WiX fragment 生成桌面与开始菜单入口

## 路径与存储
- 导出目录：应用安装目录下的 `recordings`
- 工作目录：应用安装目录下的 `work`
- 前端不展示绝对路径，通过资源协议访问（assetProtocol scope = `**`）

## 依赖与环境
- Node.js + pnpm
- Rust 工具链（Tauri 2）
- Windows：需安装 Visual Studio Build Tools（C++构建工具），并确保 WebView2 可用

## 诊断与常见问题
- 端口占用：开发端口固定为 1420，如被占用请释放后重试
- NSIS 下载失败：将 `bundle.targets` 暂时调整为 `["msi"]`，仅生成 MSI
- FFmpeg 未找到：请确认系统或打包资源中存在 FFmpeg 可执行文件

## 许可
- 本项目用于演示与内部使用，按需调整许可证与版权信息
