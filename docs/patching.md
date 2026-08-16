# DSH EAC 官方包补丁说明

本插件通过修改 DSH EAC 内置的官方 client 插件包来实现侧边栏的「项目/任务」分组与「无工作区」选项。EAC 升级会覆盖这些文件，需重新应用。

## 补丁清单

| 包 | 文件 | 改动 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-workspace` | `lib/client.js` | 侧边栏「工作区」下加「项目/任务」分组标题（36px 同高）、空状态「暂无项目/任务」、任务组强制展开、任务组隐藏文件夹行、工作区选择菜单加「无工作区（任务）」项、`isTaskSession` 让空白任务会话常驻显示 |
| `@deepseek-ai/dsh-client-runtime` | `lib/client.js` | `startSession()` 无参时进入 New Session 空状态（不再自动连接最近工作区） |
| `@deepseek-ai/dsh-client-ui-conversation` | `lib/client.js` | 无工作区会话顶部 chip 显示「无工作区（任务）」而非「选择工作区」 |
| `@deepseek-ai/dsh-client-ui-sidebar` | `lib/client.js` | （已恢复原版，无改动） |

## 重新应用

官方包在：
```
C:\Users\Administrator\AppData\Local\Programs\Deepseek Harness EAC\resources\app\node_modules\@deepseek-ai\<包名>\lib\client.js
```

每次应用前官方文件都有时间戳备份（`client.js.bak-taskrunner-<时间戳>`）。应用后**强刷页面（Ctrl+Shift+R）**即可生效，无需重启。

> 注意：这些改动是运行时补丁，非标准插件 API；EAC 大版本升级后请重新核对。
