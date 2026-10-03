# 昆虫标本采集记录台（gbinsectlog）

面向野外昆虫调查队与标本馆技术员，把「标本采集 → 采集地与生境 → 鉴定状态 → 保藏位置」串成一条可追溯的编目链路，解决采集标签手写易错、鉴定进度无人跟踪、标本入柜后找不到位置的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21815>

常用命令：

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地，不受影响）
```

端口与项目名可在 `.env` 中调整：

```
COMPOSE_PROJECT_NAME=gbinsectlog
FRONTEND_PORT=21815
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落，支持直接刷新子路由） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21815
npm run build      # 类型检查 + 生产构建
```

> 本地开发无需任何后端服务或环境变量。

## 四、目录结构

```
sologsb-1115/
├── docker-compose.yml          # 顶层 name: gbinsectlog，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── tailwind.config.js / postcss.config.js
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # specimen.ts / site.ts / storage.ts / determination.ts / treatment.ts / index.ts
│       ├── stores/             # specimenStore / siteStore / storageStore / determinationStore / treatmentStore（Zustand）
│       ├── components/common/  # SpecimenCard / StatusTag / TreatmentTag / CabinetGrid / SitePicker
│       ├── hooks/              # usePersistentStore / useSpecimenFilter
│       ├── pages/              # SpecimensPage / SitesPage / CollectPage / DeterminationPage / StoragePage / FumigationPage
│       ├── router/index.tsx
│       └── utils/              # codec.ts / treatment.ts / export.ts / id.ts
```

## 五、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Specimen 标本 | 编号、目/科/属/种、暂定名、采集日期与人、性别虫态、体长、采集方式、数量、鉴定状态 | `specimens` |
| CollectSite 采集地 | 代码、名称、行政区、经纬度海拔、生境类型、小生境、微气候、采集日期区间 | `sites` |
| Storage 保藏位置 | 保藏方式、柜/抽屉/盒/插位序号、入柜日期、经手人 | `storages` |
| Determination 鉴定记录 | 鉴定人、日期、结论（学名）、依据文献、置信度、是否需复核 | `determinations` |
| TreatmentOrder 熏蒸处理单 | 单号（FUM-年H半年-流水）、点到的柜、状态（草稿/熏蒸中/已完成）、开单与开/完工时间、转运架规模、处理人 | `treatmentOrders` |
| TreatmentItem 处理明细 | 所属处理单、标本编号快照、原插位快照、转运架位、处理状态（已出柜/回迁受阻/已回迁）、受阻占用者、结果留痕 | `treatmentItems` |

- 数据库名 `gbinsectlog`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史标本补齐默认采集方式（扫网）；
- `version(3)` 新增熏蒸处理单 / 处理明细两张表，历史数据无需迁移；
- 标本编号规则：`采集地代码-年份-流水号`（如 `QLB-2026-0007`），提交时自动分配并查重；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 六、主要页面

| 路由 | 功能 |
| --- | --- |
| `/specimens` | 标本清单：按目/科、鉴定状态、采集地、采集日期区间与关键字组合筛选，多选批量推进鉴定状态，导出命中清单 |
| `/collect` | 采集登记：选择采集地后自动带出生境/小生境/微气候，一次提交多条同批次标本，编号自动生成并查重 |
| `/sites` | 采集地管理：经纬度格式校验、各地采集次数统计、50 米内邻近采集地提示与一键合并 |
| `/determination` | 鉴定工作流：待鉴定队列逐条处理，落鉴定记录并自动推进标本状态（已鉴定 / 待复核） |
| `/storage` | 保藏柜位图：柜-抽屉-盒-位三级展开，空位/占用一目了然，拖拽入柜，重复占用给出占用提示；熏蒸封闭柜整柜暂缓入柜、预留插位独立标注，另列转运架 |
| `/fumigation` | 熏蒸处理单：开单点柜 → 开工整柜封闭、逐份疏散入转运架（原插位预留）→ 按单逐份/批量回迁对账 → 全部回迁后解封结单 |

## 七、业务约定

- 采集地代码是标本编号前缀，代码重复会被拒绝；
- 坐标 50 米内视为同一采集地，页面上给出合并提示，合并会把原采集地标本自动改挂；
- 鉴定记录提交后自动把标本状态推进为「已鉴定」，勾选「需复核」则置为「待复核」；
- 同一柜位（柜-屉-盒-位）只允许一份标本，冲突时列出已有标本编号。

### 熏蒸处理（处理组台账 × 馆藏台账）

处理组与馆藏是两份各自维护的台账：处理组按**处理单**开工，馆藏管标本编号、柜位与鉴定结论；两边各改各的，靠处理明细上开工瞬间抄下的**标本编号快照 + 原插位快照**对账，不再出现「搬出来编号和柜位对不上」。

- **单号**：`FUM-年份H半年-流水号`，如 `FUM-2026H2-001`（1–6 月 H1，7–12 月 H2），开单自动编号。
- **封闭与疏散**：开工后处理单点到的柜整柜封闭（`熏蒸中`），柜内标本按馆藏台账逐份生成处理明细、顺序放进转运架（`R架-S层位`）；**馆藏 storages 一行都不改，原插位仍算预留**。
- **鉴定不中断、入柜暂缓**：熏蒸期间鉴定工作流照常落鉴定记录；封闭柜（含预留空位）在保藏柜位图不接受任何入柜。
- **逐份回迁对账**：完工后按处理单逐份或批量回迁，系统实时比对馆藏台账——原插位此刻被**别的标本**占住，就**只拦下这一份**（落「回迁受阻」并记录占用者编号），同批其它份照常回迁。
- **失败只回滚这一份 + 幂等**：每份回迁是独立事务，受阻仅这一份不生效；对同一张单反复回迁时，已回迁的自动跳过、不新增记录、不重复占位；受阻份清出占用者后再跑一次即可。
- **解封结单**：存在未回迁（含受阻）明细时禁止结单；全部「已回迁」后方可解封，柜随即解除封闭。
- **处理状态筛选**：标本清单可按「未处理 / 已出柜 / 回迁受阻 / 已回迁」筛选，卡片上同时显示当前处理状态徽标。
