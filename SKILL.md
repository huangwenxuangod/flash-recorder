# Tauri + React 桌面应用开发 SKILL（项目栈专用）

本文基于当前技术栈与实际工作流，整理从开发到构建、签名、发布与更新的完整流程，重点覆盖 Tauri Rust 运行机制、Windows 打包与自签名、资产与图标、工作流与权限要求。

## 1. 技术栈与运行形态
- 前端：React + TypeScript + Vite  
- 桌面框架：Tauri 2（Rust）  
- 包管理：Node + pnpm  
- UI：Tailwind CSS + @heroui/react  
- 打包：Windows MSI（WiX）+ NSIS  
- 更新：Tauri Updater + GitHub Releases  

## 2. Tauri Rust 核心运行流程
1. 前端入口  
   - Vite 多入口构建（main / mini / edit）  
2. Tauri 启动流程  
   - 初始化插件（updater / process / dialog / autostart / opener）  
   - 注册 command（Rust 函数暴露给前端调用）  
   - 启动多窗口与权限能力  
3. 资源与路径  
   - 打包资源通过 bundle.resources 注入  
   - 运行时优先从资源目录解析路径  
   - 安装目录与运行目录必须兼容  

## 3. 开发到构建的完整流程

### 3.1 环境准备
- Node.js + pnpm  
- Rust 工具链（tauri-cli 2）  
- Windows：Visual Studio Build Tools + Windows SDK  
- WebView2 可用  

### 3.2 本地开发流程
1. 启动前端开发服务器  
2. 启动 Tauri Dev（绑定固定端口）  
3. 验证多窗口与前端热更新  

### 3.3 本地构建流程
1. 前端构建  
   - 生成多入口产物  
2. Tauri 打包  
   - 生成 MSI / NSIS  
   - 输出 updater 产物（latest.json / *.sig）  

## 4. Windows 打包与签名

### 4.1 安装包与升级
- MSI  
  - UpgradeCode 必须固定  
  - 覆盖安装依赖 UpgradeCode 与稳定安装路径  
- NSIS  
  - installMode 影响安装路径与覆盖策略  

### 4.2 自签名与证书
- 安装包签名  
  - 使用 signtool.exe  
  - 证书可自签或正式证书  
- 资源签名  
  - 外部可执行资源需要签名  

### 4.3 图标与资产
- icon.ico 必须配置在 bundle.icon  
- 资源文件放入 bundle.resources  
- 路径访问使用资源解析逻辑  

## 5. 自动更新体系
1. updater 配置  
   - pubkey 必须与私钥匹配  
   - endpoints 指向 latest.json  
2. 更新产物  
   - latest.json  
   - *.sig  
3. 更新流程  
   - 检查更新 → 下载 → 安装 → 重启  
4. 常见问题  
   - pubkey/私钥不匹配导致校验失败  
   - latest.json 不在 Release 或 URL 不可访问  

## 6. 权限与能力要求
- capabilities 必须声明前端可用能力  
- 更新能力需要 updater 相关权限  
- 窗口控制需要 window 权限  
- 文件打开/保存需要 dialog 与 opener 权限  

## 7. CI/CD 工作流（Windows）
1. 安装 Node / pnpm / Rust  
2. 注入外部资源（如 ffmpeg）  
3. 设置签名证书  
4. 注入 updater 私钥  
5. 构建 MSI/NSIS 与 updater 产物  
6. 签名安装包与资源  
7. 上传 Release 资产  

## 8. 常见问题与排查

### 8.1 打包失败
- 缺失 Windows SDK 或 C++ 工具链  
- WebView2 引导安装配置错误  

### 8.2 资源找不到
- resources 未打包  
- 资源路径解析不兼容安装目录  

### 8.3 更新失败
- latest.json 缺失或 URL 访问失败  
- 更新签名校验失败  
- 版本号不一致  

### 8.4 安装覆盖失败
- MSI UpgradeCode 变更  
- 安装路径不一致  

## 9. 构建发布检查清单
- 版本号统一  
- icon.ico 与资源完整  
- updater pubkey 与私钥一致  
- latest.json 与签名文件已上传  
- MSI/NSIS 可覆盖安装  
