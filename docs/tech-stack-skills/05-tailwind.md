# 05 · Tailwind CSS v4 核心栈 Skill 调研

> **项目版本**：Tailwind CSS 4.3.3 + @tailwindcss/postcss 4.3.3 + CVA 0.7 + clsx 2.1 + tailwind-merge 3.6
> **核心定位**：原子化 CSS 框架（v4 全新架构，CSS-first 配置）
> **最后更新**：2026-07-22

---

## 1. 核心 Skill 速查

| Skill | 评级 | 来源 | 触发词 | 核心价值 |
|-------|------|------|--------|----------|
| `tailwind-v4-shadcn` | ⭐⭐⭐必装 | clawdbot 社区 | "Tailwind v4" / "暗色模式" / "@theme" | 4 步主题架构 + 8 大错误预防 |
| `shadcn` | ⭐⭐⭐必装 | shadcn 官方 | "shadcn init" / "组件" / "registry" | 5 大类 25 条规则 |
| `vercel-react-best-practices` | ⭐推荐 | Vercel | "CSS 性能" / "content-visibility" | rendering 10 条 |

> **Skill 路径**：
> - `c:\Users\Lenovo\.trae-cn\skills\tailwind-v4-shadcn\SKILL.md`
> - `c:\Users\Lenovo\.trae-cn\skills\shadcn\SKILL.md`

---

## 2. Tailwind v4 4 步主题架构（MANDATORY）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\tailwind-v4-shadcn\SKILL.md`
> **警告**：跳过步骤会破主题，必须**按序**完成 4 步。

### Step 1：根级 CSS 变量

```css
/* src/index.css */
@import "tailwindcss";
@import "tw-animate-css";

:root {
  --background: hsl(0 0% 100%);
  --foreground: hsl(222.2 84% 4.9%);
  --primary: hsl(221.2 83.2% 53.3%);
  --primary-foreground: hsl(210 40% 98%);
  /* ... */
}

.dark {
  --background: hsl(222.2 84% 4.9%);
  --foreground: hsl(210 40% 98%);
  --primary: hsl(217.2 91.2% 59.8%);
  --primary-foreground: hsl(222.2 47.4% 11.2%);
  /* ... */
}
```

### Step 2：`@theme inline` 映射到 Tailwind 工具类

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  /* ... */
}
```

### Step 3：在 components.json 启用 CSS 变量

```json
{
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  }
}
```

### Step 4：删除 v3 配置文件

```bash
rm tailwind.config.ts
```

> **v4 不再需要 `tailwind.config.ts`**，所有配置在 CSS 里。

---

## 3. 项目色板（v1.0 UI 设计稿）

> **约束**：所有新组件必须用 `var(--color-*)` 变量，禁止硬编码 `#ffffff` / `#fafafa` / `#0071e3`。
> **来源**：项目 `project_memory.md` 硬约束

| 用途 | 亮色 | 暗色 |
|------|------|------|
| 主色（低饱和靛蓝） | `#4f46e5` | `#818cf8` |
| 背景 | `--color-background` | `--color-background` |
| 前景 | `--color-foreground` | `--color-foreground` |
| 边框 | `--color-border` | `--color-border` |
| 状态-成功 | `--color-success` | `--color-success` |
| 状态-警告 | `--color-warning` | `--color-warning` |
| 状态-错误 | `--color-error` | `--color-error` |

### 3.1 颜色硬约束

```css
/* ❌ 错（硬编码） */
.btn { background: #4f46e5; color: #ffffff; }

/* ✅ 对（CSS 变量） */
.btn {
  background: var(--color-primary);
  color: var(--color-primary-foreground);
}
```

```tsx
// ❌ 错
<div className="bg-white text-black">

// ✅ 对
<div className="bg-background text-foreground">
```

---

## 4. shadcn Skill 5 大类规则（必装）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\shadcn\SKILL.md`

### 4.1 Styling & Tailwind（7 条）

| 规则 | 含义 |
|------|------|
| `className for layout, not styling` | 不要覆盖组件的颜色 / 排版 |
| **`No space-x-* or space-y-*`** | 用 `flex` + `gap-*`（重要！） |
| `size-*` 当 width = height | `size-10` 代替 `w-10 h-10` |
| `truncate` 简写 | 代替 `overflow-hidden text-ellipsis whitespace-nowrap` |
| **No manual `dark:` overrides** | 用语义 token（`bg-background`） |
| `cn()` 条件 className | 不用模板字符串三元 |
| No manual `z-index` on overlay | Dialog / Sheet / Popover 自管 |

### 4.2 Forms & Inputs（6 条）

```tsx
// ✅ 字段用 FieldGroup + Field，不用 div + space-y
<FieldGroup>
  <Field>
    <FieldLabel htmlFor="email">Email</FieldLabel>
    <Input id="email" />
  </Field>
</FieldGroup>

// ✅ 校验：data-invalid 在 Field，aria-invalid 在 control
<Field data-invalid>
  <FieldLabel>Email</FieldLabel>
  <Input aria-invalid />
  <FieldDescription>Invalid email.</FieldDescription>
</Field>

// ✅ 选项集（2-7 选）用 ToggleGroup，不循环 Button
<ToggleGroup type="single" value={x} onValueChange={setX}>
  <ToggleGroupItem value="a">A</ToggleGroupItem>
  <ToggleGroupItem value="b">B</ToggleGroupItem>
</ToggleGroup>
```

### 4.3 Component Structure（7 条）

| 规则 | 含义 |
|------|------|
| **Items 永远在 Group 内** | `SelectItem` → `SelectGroup` |
| **`asChild` / `render`** | 自定义 trigger 用 `asChild`（radix）|
| **Dialog / Sheet / Drawer 必带 Title** | 无障碍要求 |
| **Card 完整组成** | Header/Title/Description/Content/Footer |
| Button 无 `isLoading` | 用 `Spinner` + `data-icon` + `disabled` 组合 |
| **`TabsTrigger` 在 `TabsList` 内** | 不能直接放 Tabs |
| **`Avatar` 必带 `AvatarFallback`** | 图片加载失败 fallback |

### 4.4 Use Components, Not Custom Markup（6 条）

| 用 | 不用 |
|----|------|
| `<Alert>` | 自定义 styled div |
| `<Empty>` | 自定义 empty state |
| `toast()` from sonner | 自定义通知 |
| `<Separator>` | `<hr>` 或 `<div className="border-t">` |
| `<Skeleton>` | 自定义 `animate-pulse` div |
| `<Badge>` | 自定义 styled span |

### 4.5 Icons（3 条）

- `Button` 内 icon 用 `data-icon="inline-start"` / `data-icon="inline-end"`
- 组件内 icon 不写 size 类（CSS 自管）
- icon 传 object 不传 string（`icon={CheckIcon}` 不是 `icon="check"`）

---

## 5. CVA（class-variance-authority）+ clsx + tailwind-merge

### 5.1 组合三件套

```typescript
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// 1. cn 工具
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 2. variant 定义
const button = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground'
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-11 px-8 text-lg'
      }
    },
    defaultVariants: { variant: 'default', size: 'md' }
  }
)

// 3. 组件
interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}
```

### 5.2 项目应用

- 所有自定义组件用 CVA 模式
- `cn()` 工具放 `src/renderer/src/utils/cn.ts`

---

## 6. v3 → v4 升级要点

| 变化 | v3 | v4 |
|------|----|----|
| 配置文件 | `tailwind.config.ts` | 删掉，CSS-first |
| 颜色 | `theme.extend.colors` | `@theme` + CSS 变量 |
| 暗色 | `darkMode: 'class'` | `@variant dark` 或 `:root.dark` |
| PostCSS | `tailwindcss` | `@tailwindcss/postcss` |
| 动画 | `tailwind.config.ts` | `@theme` 配 `--animate-*` |
| `@apply` | 警告 | 仍支持但推荐不用 |
| `content` | 必须配 glob | 自动检测 |

### 6.1 迁移步骤

```bash
# 1. 升级
pnpm add tailwindcss@latest @tailwindcss/postcss

# 2. postcss.config.js 改用新插件
export default {
  plugins: { '@tailwindcss/postcss': {} }
}

# 3. 删 v3 config
rm tailwind.config.ts

# 4. CSS 改 v4 语法
# @tailwind base/components/utilities
# ↓
# @import "tailwindcss";

# 5. 配置 @theme
@theme { --color-primary: hsl(...); }
```

---

## 7. Vercel React 渲染性能（10 条）

> **来源**：`c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\rules\rendering-*`

| 规则 | 用途 |
|------|------|
| `rendering-conditional-render` | 条件分支用三元 + 处理 0 |
| `rendering-hoist-jsx` | 稳定 JSX 提到组件外 |
| `rendering-content-visibility` | `content-visibility: auto` 跳屏幕外 |
| `rendering-usetransition-loading` | loading 用 `useTransition` |
| `rendering-activity` | `<Activity>` 控制可见性 |
| `rendering-resource-hints` | `<link rel="preload">` |
| `rendering-script-defer-async` | 脚本 defer/async |
| `rendering-svg-precision` | SVG 精度 |
| `rendering-hydration-no-flicker` | 无 hydration 闪烁 |
| `rendering-animate-svg-wrapper` | SVG 动画包装 |

### 7.1 `content-visibility` 用法

```css
/* 跳过屏幕外渲染 */
.long-list-item {
  content-visibility: auto;
  contain-intrinsic-size: 200px; /* 占位高度 */
}
```

---

## 8. Tailwind 4 8 大错误预防

来自 `tailwind-v4-shadcn` Skill 的错误清单：

| # | 错误 | 根因 | 修复 |
|---|------|------|------|
| 1 | 颜色不工作 | 缺 `@theme` 映射 | 加 `--color-*` |
| 2 | 暗色模式不切换 | 缺 `.dark` 类或 CSS 变量 | 加 CSS 变量 + class |
| 3 | build 失败 | 用了 v3 语法 `tailwind.config.ts` | 删 v3 配置 |
| 4 | `@theme inline` 不生效 | 拼写错误 | 拼对 |
| 5 | `@apply` 警告 | 仍支持但过时 | 改用 `@layer` |
| 6 | `@layer base` 顺序错 | 必须在 `@import "tailwindcss"` 之后 | 调整顺序 |
| 7 | tw-animate-css 不工作 | 没装或没 import | 装 + import |
| 8 | 暗色 + 系统主题冲突 | 没监听 `prefers-color-scheme` | 用 `useTheme` hook |

---

## 9. 项目已踩坑

| 踩坑 | 根因 | 修复 |
|------|------|------|
| 暗色模式不切换 | 缺 `.dark` 切换逻辑 | 装 next-themes 或自写 `useTheme` |
| 颜色硬编码 `#ffffff` | 未用 CSS 变量 | 全切 `var(--color-*)` |
| `space-y-4` 残留 | 旧代码 | 全切 `flex flex-col gap-4` |
| Tailwind 3 配置残留 | v3 → v4 升级不彻底 | 删 `tailwind.config.ts` |
| shadcn 组件 className 覆盖 | 违反 shadcn 规则 | 用 `cn()` 合并 |

---

## 10. 最佳实践清单

1. **所有颜色用 `var(--color-*)`**，不硬编码
2. **主色用 CSS 变量**（`#4f46e5` 亮 / `#818cf8` 暗）
3. **暗色模式默认开启**（项目硬约束）
4. **不写 `space-x-*` / `space-y-*`**，用 `flex` + `gap-*`
5. **不写 `dark:` 覆盖**，用语义 token
6. **条件 className 用 `cn()`**，不写模板字符串
7. **不覆盖组件内 className**（className 只做 layout）
8. **Card 完整组成**（Header/Title/Description/Content/Footer）
9. **shadcn 组件优先**，不重写
10. **大列表用 `content-visibility: auto`**

---

## 11. 推荐阅读顺序

1. `c:\Users\Lenovo\.trae-cn\skills\tailwind-v4-shadcn\SKILL.md`（必读）
2. `c:\Users\Lenovo\.trae-cn\skills\shadcn\SKILL.md`（必读）
3. [Tailwind v4 官方升级指南](https://tailwindcss.com/docs/upgrade-guide)
4. 项目 `src/renderer/src/index.css` 实际主题

---

## 12. 引用文档

- `c:\Users\Lenovo\.trae-cn\skills\tailwind-v4-shadcn\SKILL.md` — 必读
- `c:\Users\Lenovo\.trae-cn\skills\shadcn\SKILL.md` — 必读
- `c:\Users\Lenovo\.trae-cn\skills\vercel-react-best-practices\SKILL.md` — 渲染性能
- `d:\ai\linux教学一体\tdsf-linux-desktop\AGENTS.md` v8.4 — 颜色系统约束
- `d:\ai\linux教学一体\tdsf-linux-desktop\docs\UI设计规范-v2.0.md` — 设计稿色板
