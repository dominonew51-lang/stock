# Minimalism 个人投资面板

私人资产总览，用于查看总资产、收益走势、投资方向、持仓热力图和持仓明细。项目运行在 Cloudflare Workers，使用 D1 保存授权设备的持仓与每日资产快照。

## 开发环境

- Node.js `>=22.13.0`
- 依赖锁文件：`pnpm-lock.yaml`
- Cloudflare 配置：`wrangler.jsonc`
- 生产地址：<https://minimalism-portfolio.minimalism-domibook.workers.dev/>

## 常用命令

```bash
corepack pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build:workers
pnpm check
```

- `pnpm test`：运行当前产品的源码与数据规则测试。
- `pnpm test:browser`：需要可访问的测试地址时，运行实际页面检查。
- `pnpm check`：依次运行测试、类型检查、Workers 生产构建和部署预检。
- `pnpm deploy`：通过全部检查后发布到上述唯一地址，并保留线上环境变量。

## 数据与定时任务

- `portfolio_states`：保存授权设备的当前持仓状态。
- `portfolio_snapshots`：每日北京时间 23:59 保存总市值、总成本和收益率。
- 日历、A股行情页和美股行情页已从当前产品下线，不应恢复其旧测试或空跑定时任务。

## 发布核对

发布后需同时确认：

1. Wrangler 返回新的 deployment ID。
2. 生产地址返回 HTTP 200。
3. HTML 引用的 JS/CSS 资源为新构建版本。
4. 手机与电脑端均能读取云端持仓，且每日资产快照定时任务仍在。
