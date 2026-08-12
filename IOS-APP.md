# iOS App（Capacitor 套壳）使用指南

网站已通过 Capacitor 打包为原生 iOS app。**网站代码和部署完全不受影响**：app 只是把 React 前端装进一个原生壳，直接连腾讯云上现有的后端 API（`https://www.garbagebpfilter.cn`），用户账号、数据与网页版完全互通。

## 本次改动清单

| 文件                                         | 说明                                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| `client/ios/`                                | 新增，Capacitor 生成的 Xcode 工程（iOS 壳）                 |
| `client/capacitor.config.json`               | 新增，app 配置（appId：`cn.garbagebpfilter.app`）           |
| `client/package.json`                        | 加了 Capacitor 依赖和 `ios:build` / `ios:open` 两个脚本     |
| `client/src/pages/TrackingDashboardPage.jsx` | 导出接口改用统一的 `API_BASE`（原来是 `window.__API_BASE`） |
| `server/middleware/security.js`              | CORS 白名单放行 app 来源 `capacitor://localhost`            |
| `.gitignore`                                 | 忽略 iOS 构建产物（Pods、public 等），Xcode 工程本身入库    |

## 在 Mac 上运行 app（首次）

前置：Xcode 16+（App Store 免费下载）、CocoaPods（`brew install cocoapods` 或 `sudo gem install cocoapods`）。

```bash
cd client

# 1. 重装依赖（package.json 加了新依赖；之前有一次中断的安装，建议删掉重来）
rm -rf node_modules && npm install

# 2. 构建前端并同步进 iOS 工程（API 地址已固定为线上域名）
npm run ios:build

# 3. 打开 Xcode 工程
npm run ios:open
```

在 Xcode 里：

1. 左侧选中 **App** 项目 → **Signing & Capabilities** → Team 选择你的 Apple ID（Xcode → Settings → Accounts 里先登录，免费账号即可）。
2. 顶部选择你的 iPhone（USB 连接，手机上信任这台电脑）或模拟器。
3. 点 ▶ 运行。首次真机运行需在手机 **设置 → 通用 → VPN与设备管理** 里信任开发者证书。

> 免费 Apple ID 签名 7 天过期，过期后重新在 Xcode 点一次运行即可。以后想上架 App Store 或 TestFlight 分发，再注册开发者账号（$99/年），工程无需改动。

## 服务器要做的一件事

`server/middleware/security.js` 改了 CORS（放行 `capacitor://localhost`），需要重新部署一次腾讯云后端才生效，否则 app 请求会被跨域拦截：

```bash
git pull && docker-compose up -d --build   # 或你现有的部署方式
```

## 日常更新流程

前端代码有改动后，让 app 也拿到新版本：

```bash
cd client && npm run ios:build   # 重新构建并同步
```

然后 Xcode 重新运行/打包即可。网页版照常 `npm run build` 部署，两者互不干扰。

## 常见问题

- **app 白屏**：多半是 CORS 未生效（后端没重新部署）或手机无法访问 `https://www.garbagebpfilter.cn`。可在 Safari → 开发菜单 → 连接的 iPhone 里看 WebView 控制台。
- **换 API 域名**：改 `client/package.json` 里 `ios:build` 脚本中的 `REACT_APP_API_URL`，重新 `npm run ios:build`。
- **改 app 名称/图标**：名称在 `client/capacitor.config.json` 的 `appName`；图标放 `client/ios/App/App/Assets.xcassets/AppIcon.appiconset/`（1024×1024 PNG，Xcode 会自动生成各尺寸）。
