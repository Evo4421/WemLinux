# WemLinux

WemLinux 是一个运行在浏览器中的精简 Linux 模拟环境(HummingLinux)，由 **webfs**（虚拟文件系统）+ **wemlinux shell**（121 个内置命令的 shell 解释器）组成，全部集成在**一个js文件**中，浏览器引入即可使用

- 作者: Evo
- 工作室: 凌寒科技

---

## 快速开始

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WemLinux</title>
</head>
<body>
  <input id="shell-input" placeholder="输入命令，回车执行">
  <pre id="shell-output"></pre>
  <script src="wemlinux.js"></script> //或者wemlinux2.js
  <script>
    const input = document.getElementById('shell-input');
    const output = document.getElementById('shell-output');

    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      const result = await window.executeShellCommand(input.value);
      output.textContent += '$ ' + input.value + '\n' + result + '\n';
      input.value = '';
    });
  </script>
</body>
</html>
```

引入 `wemlinux.js` 后，环境自动初始化：

- 文件系统：`/bin /dev /etc /home /proc /system /tmp /usr /var` 等标准目录树
- 预置文件：`/etc/hostname`（humminglinux）、`/etc/motd`、`/etc/passwd`、`/home/user/README.txt`
- 环境变量：`PATH / HOME / TERMINAL / SHELL / USER / HOSTNAME`

---

## 外部 API 文档

WemLinux 在 `window` 上暴露以下 API：

### `window.executeShellCommand(command)`

执行一条 shell 命令（支持管道、重定向、变量、控制流）。

| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | `string` | 要执行的命令字符串 |

**返回** `Promise<string>` —— 命令输出。重定向到文件时返回空串。

```js
await window.executeShellCommand('ls -la /etc');
// "-rw-r--r-- root root        0 hostname\ndrwxr-xr-x ..."
```

### `window.handleCommand(command)`

`executeShellCommand` 的别名，二者等价。

### `window.commandRouter`

命令路由器对象，包含所有已注册命令：

| 方法 | 说明 |
|------|------|
| `commandRouter.register(name, handler)` | 注册命令 |
| `commandRouter.getHandler(name)` | 获取命令处理函数 |
| `commandRouter.has(name)` | 检查命令是否存在 |
| `commandRouter.execute(name, args)` | 直接执行命令（跳过解析） |
| `commandRouter.registered` | 已注册命令名数组 |

### `window.registerCommand(name, handler)`

**外部注入命令 API** —— 不修改源码即可添加新命令。

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 命令名（字母/数字/下划线） |
| `handler` | `Function` | `(args: string[]) => string \| Promise<string>` |

**返回** `boolean` —— 注册是否成功。

```js
window.registerCommand('hello', (args) => 'Hello, ' + (args.join(' ') || 'world') + '!');

await window.executeShellCommand('hello Evo'); // "Hello, Evo!"
```

已存在的命令可以被覆盖（同名后注册者生效）。

### `window.safeResolvePath(path)`

解析路径，支持 `~` `-` `.` `..` 语法，返回绝对路径。

```js
window.safeResolvePath('~/documents/file.txt'); // "/home/user/documents/file.txt"
```

### `window.getFileModeString(path)`

获取文件权限字符串（供 `ls -l` 等使用）。

```js
window.getFileModeString('/etc/hostname'); // "-rw-r--r--"
window.getFileModeString('/etc');          // "drwxr-xr-x"
```

### `window.webfs`

webfs 虚拟文件系统对象（纯内存树形结构，零依赖）：

| 方法 | 说明 |
|------|------|
| `webfs.read(path)` | 读取文件内容（软链接自动解析） |
| `webfs.write(path, content)` | 写入文件 |
| `webfs.delFile(path)` | 删除文件 |
| `webfs.fileExist(path)` | 文件是否存在 |
| `webfs.isDir(path)` | 是否为目录 |
| `webfs.getFileList(path)` | 列出目录项 `[{name, type, size}]` |
| `webfs.getFileSize(path)` | 获取文件大小 |
| `webfs.mkdir(path)` | 创建目录（支持 `-p` 递归） |
| `webfs.rename(old, new)` | 重命名/移动 |
| `webfs.stat(path)` | 获取文件元信息 `{type, mode, size}` |
| `webfs.chmod(path, mode)` | 修改权限 |
| `webfs.exists(path)` | 路径是否存在 |
| `webfs.normalizePath(path)` | 规范化路径 |
| `webfs.exit()` | 清理环境 |

### `window._state`

全局状态对象：

```js
{
  cwd: "/",          // 当前工作目录
  pid: "12345",      // 进程 ID
  env: {...},        // 环境变量
  vars: {...},       // 用户变量
  aliases: {...},    // 别名
  history: [...],    // 命令历史
  lastOutput: "",    // 最后输出
  lastExitCode: 0,   // 最后退出码
  oldpwd: "/",       // 上一个目录（cd -）
  dirStack: [],      // 目录栈（pushd/popd）
  functions: {},     // shell 函数
  jobs: [],          // 后台任务
  ulimit: {...}      // 资源限制
}
```

### `window._sudoMode`

布尔值，是否处于 sudo 模式（默认 `false`）。

---

## 添加命令

### 方式一：外部注入（推荐，不改源码）

```js
window.registerCommand('greet', (args) => {
  const name = args[0] || 'world';
  return `Hi ${name}, welcome to WemLinux!`;
});

// 支持异步
window.registerCommand('fetch', async (args) => {
  // 这里可以 fetch 网络数据
  return 'data fetched';
});
```

### 方式二：源码内注册

在 `wemlinux.js` 中 `s.register("exit", ...)` 附近追加：

```js
s.register("greet", function(e) {
  return "Hi " + (e.join(" ") || "world") + ", welcome to WemLinux!";
});
```

### 方式三：借助 commandRouter（运行时动态注册）

```js
window.commandRouter.register('greet', (args) => 'Hi ' + args.join(' '));
```

---

## 命令编写规范

### Handler 签名

```js
/**
 * @param {string[]} args - 命令参数（不含命令名本身）
 * @returns {string|Promise<string>} 输出文本
 */
function handler(args) { ... }
```

### 返回值约定

| 返回值 | 含义 |
|--------|------|
| `string`（非空） | 正常输出，直接显示 |
| `""`（空串） | 成功但无输出（如 `rm`） |
| `"sh: xxx: No such file or directory"` | 错误信息，`lastExitCode` 置 1 |
| `"__CLEAR__"` | 清空终端 |
| `"__BREAK__"` / `"__CONTINUE__"` / `"__RETURN__"` | 控制流信号 |

### 参数解析约定

- 参数由 shell 按**空白**分割（不处理引号），引号需在命令内部自行剥离（参考 `find -name "*.txt"` 的去引号处理）。
- 路径参数建议先经 `window.safeResolvePath` 或内部 `a(path)` 解析。
- 可选参数（flag）用 `-x` 形式，未知选项返回错误：
  ```js
  if (args[0].startsWith('-')) return "greet: invalid option '" + args[0] + "'";
  ```

### 文件系统访问

统一通过 `webfs` 对象（内部变量 `webfs` / 全局 `window.webfs` 等价）：

```js
if (!webfs.fileExist(path)) return "cmd: " + path + ": No such file or directory";
if (webfs.isDir(path))      return "cmd: " + path + ": Is a directory";
const content = webfs.read(path) || "";
```

---

## WemLinux 使用教程

### 基础命令

```
pwd                          # 当前目录
ls / ls -la /etc             # 列出目录（-a 含隐藏，-l 详细信息）
cd /etc && pwd               # 切换目录
cat /etc/hostname            # 查看文件
echo "hello world"           # 输出文本
clear                        # 清屏
history                      # 查看命令历史
whoami / id / uname -a       # 用户 / 系统信息
```

### 文件操作

```
mkdir -p /home/user/blog     # 递归创建目录
touch /tmp/a.txt             # 创建空文件
cp a.txt b.txt               # 复制
mv a.txt renamed.txt         # 移动/重命名
rm file / rm -rf dir         # 删除
ln -s /etc/hostname /tmp/l   # 符号链接（cat 自动解析）
find /home -name "*.txt"     # 按名查找（支持 * 和 ? 通配）
tree /etc                    # 目录树
du -s /etc                   # 目录占用
stat /etc/hostname           # 文件详细信息
chmod 755 script.sh          # 修改权限
```

### 文本处理

```
sort file.txt                # 排序（-n 数值 -r 倒序 -u 去重 -f 忽略大小写）
grep keyword file.txt        # 搜索
head -3 file.txt             # 头部
tail -2 file.txt             # 尾部
wc -l / -w / -c file.txt     # 行/词/字节数
sed 's/a/b/' file.txt        # 替换
awk '{print $1}' file.txt    # 列提取
uniq file.txt                # 去重
cut -d: -f1 /etc/passwd      # 按分隔符截取
```

### 重定向与管道

```
echo "hello" > file.txt      # 覆盖写入
echo "again" >> file.txt     # 追加
cat /etc/passwd | grep user  # 管道
ls / && echo "OK"            # 成功才执行
cat x || echo "失败"          # 失败才执行
```

### 进程与系统

```
ps / top                     # 进程列表
kill <pid>                   # 杀进程
free                         # 内存
df / mount / umount          # 磁盘/挂载
uptime                       # 运行时间
date                         # 日期
sleep 2                      # 延时
```

### 网络（模拟）

```
ping baidu.com               # Ping
curl http://example.com      # 请求（模拟）
wget http://example.com/a    # 下载（模拟）
netstat / ifconfig           # 网络状态
hostname                     # 主机名
```

### 环境变量

```
echo $HOME                   # 查看变量
export MY_VAR=hello          # 导出
unset MY_VAR                 # 删除
set / env                    # 列出全部
readonly RO=1                # 只读变量（无法修改）
```

### Shell 编程

```
# if / else
if test -f /etc/hostname; then echo "存在"; else echo "不存在"; fi

# for 循环
for i in 1 2 3; do echo "第$i次"; done

# while 循环
while test $x -lt 3; do echo $x; x=$((x+1)); done

# 函数
function greet() { echo "Hello $1"; }
greet Evo

# 别名
alias ll="ls -la"
ll /etc
```

### 帮助系统

```
help                # 列出全部命令
help ls             # 查看单个命令用法
```

### wemlinux2

wemlinux2与wemlinux的差别很大，因此专门区分两个版本文件发布，以适配不同需求的人群

1: 所有数据直接通过内存存储，刷新页面数据清空
2: 通过IndexedDB存储webfs对象，数据持久化，但可能导致一些安全风险

1: 所有命令存储在全局对象
2: 系统预装的所有命令存储在/bin，可以直接用绝对路径调用命令

1: 系统密码10086
2: 系统无默认密码，可以通过passwd修改

1: 无配置文件
2: ~/.bashrc和~/.profile配置文件

1: PATH环境变量无作用
2: PATH环境变量支持加载命令等等原生功能

1: 支持命令扩展
2: 同样支持，但是后期将推出的**WPK**扩展包管理器只支持wemlinux 2

外部api无变化

---

## 浏览器要求

- Chrome 57+
- Firefox 52+
- Microsoft Edge 15+
- Safari 10.1+
- FF 48

**注意: IE全系均不支持wemlinux运行!**

## License

MIT License

