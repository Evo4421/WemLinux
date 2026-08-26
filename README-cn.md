# WemLinux 教程

WemLinux 是一个跑在浏览器里的精简版linux环境：它用内存模拟了一个完整文件系统（webfs），内置一个支持管道、重定向、变量、函数和控制流的 shell，全部打包在**一个 js 文件**里。这个教程会带你从"会跑命令"到"能自己写命令、操作文件系统、调用全部 API"。

当前版本：**wemlinux2 v2.3**（作者 Evo，MIT License）

---

## 目录

- [第一步：把 WemLinux 跑起来](#第一步把-wemlinux-跑起来)
- [理解架构：四样东西是怎么配合的](#理解架构四样东西是怎么配合的)
- [基础 API 教程（window.\*）](#基础-api-教程window)
  - [webfs：虚拟文件系统](#1-webfs虚拟文件系统)
  - [executeShellCommand：跑命令](#2-executeshellcommand跑命令)
  - [commandRouter 与 registerCommand：命令系统](#3-commandrouter-与-registercommand命令系统)
  - [safeResolvePath 与 getFileModeString](#4-saferesolvepath-与-getfilemodestring)
  - [_state：shell 的真身](#5-_stateshell-的真身)
- [标准库教程（window.wemlinux.stdlib）](#标准库教程windowwemlinuxstdlib)
  - [stdlib.fs：文件操作](#stdlibfs文件操作)
  - [stdlib.path：路径处理](#stdlibpath路径处理)
  - [stdlib.io：往 shell 输出](#stdlibio往-shell-输出)
  - [stdlib.sys：环境与进程](#stdlibsys环境与进程)
  - [stdlib.proc：命令管理](#stdlibproc命令管理)
  - [stdlib.utils：小工具](#stdlibutils小工具)
- [实战：写一个完整的自定义命令](#实战写一个完整的自定义命令)
- [system 速览（__sys）](#system-速览sys)
- [内置命令速查表](#内置命令速查表)
- [浏览器要求与 License](#浏览器要求与-license)

---

## 第一步：把 WemLinux 跑起来

在 HTML 页面引入脚本，打开控制台就能玩：

```html
<!DOCTYPE html>
<html>
<body>
  <script src="wemlinux2.min.js"></script>
  <script>
    // 等文件系统初始化完成（脚本内部会异步加载 IndexedDB 数据）
    setTimeout(async () => {
      const out = await window.executeShellCommand('ls -la /etc');
      console.log(out);
    }, 300);
  </script>
</body>
</html>
```

控制台应该输出类似：

```
-rw-r--r-- root root 0 hostname
drwxr-xr-x root root 0 init.d
...
```

> 想更早拿结果？直接调用 `window.webfs` 是同步的，不需要等待：
> ```js
> console.log(window.webfs.read('/etc/hostname')); // "humminglinux"
> ```

---

## 理解架构：四样东西是怎么配合的

WemLinux 由四个层次组成，理解它们的关系，后面学 API 就不晕了：

```
┌────────────────────────────────────────────────────────┐
│ ① webfs —— 文件系统                                     │
│    内存里的一棵树：/bin、/etc、/home/user...             │
│    所有读写文件的 API 都长在它身上                       │
├────────────────────────────────────────────────────────┤
│ ② shell —— 命令解释器                                   │
│    把 "ls -la /etc" 拆成命令 + 参数，去 ③ 里找处理函数   │
│    处理管道 | 重定向 > 变量 $x 控制流 for/if...          │
├────────────────────────────────────────────────────────┤
│ ③ commandRouter —— 命令注册表                           │
│    一张表：命令名 → 处理函数。113 个内置命令都登记在这    │
│    你也可以往里加自己的命令（registerCommand）           │
├────────────────────────────────────────────────────────┤
│ ④ system / stdlib —— 对外接口                           │
│    写命令时用的工具箱：system 面向宿主环境，              │
│    stdlib 面向命令开发者（本教程重点）                    │
└────────────────────────────────────────────────────────┘
```

**一句话记忆**：shell 负责"说话"，commandRouter 负责"找人办事"，webfs 负责"存东西"，stdlib 是"给你的工具箱"。

接下来，我们从最底层的 webfs 开始，一层层往上。

---

## 基础 API 教程（window.*）

### 1. webfs：虚拟文件系统

**它是什么**：一个运行在内存里的文件树，根是 `/`，默认建好了 `/bin`、`/etc`、`/home/user`、`/tmp` 等目录。所有 `ls`、`cat` 命令背后操作的都是它。

**读写文件**（最常用的两个）：

```js
// 写入：如果 /tmp 不存在，会自动创建父目录
window.webfs.write('/tmp/note.txt', 'Hello WemLinux');

// 读取
const text = window.webfs.read('/tmp/note.txt');
console.log(text); // "Hello WemLinux"
```

**判断存在 / 类型**：

```js
window.webfs.fileExist('/tmp/note.txt'); // true
window.webfs.fileExist('/tmp/nope.txt'); // false
window.webfs.isDir('/etc');              // true
window.webfs.isDir('/tmp/note.txt');     // false
```

**列目录**：

```js
window.webfs.getFileList('/etc');
// [{name:"hostname", type:"file", size:13}, {name:"passwd", type:"file", ...}, ...]
```

**目录操作**：

```js
window.webfs.mkdir('/home/user/projects');     // 创建目录（父目录不存在也会自动建）
window.webfs.rename('/tmp/note.txt', '/home/user/projects/note.md'); // 移动/重命名
window.webfs.delFile('/home/user/projects/note.md'); // 删除文件
```

**元信息与权限**：

```js
const st = window.webfs.stat('/etc/hostname');
// {mode:"0644", owner:"root", group:"root", size:13, mtime:..., type:"file"}

window.webfs.chmod('/etc/hostname', '0755');   // 改成可执行
// 注意：mode 用 4 位字符串，首位会被忽略，实际生效的是后 3 位
```

**软链接**（类似 Linux 的 ln -s）：

```js
window.webfs.symlink('/etc/hostname', '/tmp/hn');  // /tmp/hn 指向 /etc/hostname
window.webfs.read('/tmp/hn');       // 自动解析，返回 "humminglinux"
window.webfs.isLink('/tmp/hn');     // true
window.webfs.readlink('/tmp/hn');   // "/etc/hostname"
```

**持久化**（wemlinux2 特色）：

```js
await window.webfs.save();   // 把整棵树写入 IndexedDB
await window.webfs.load();   // 下次打开页面时恢复
```

**路径规范化**：

```js
window.webfs.normalizePath('/a/./b/../c'); // "/a/c"
```

> **什么时候用 webfs**：你要读写文件、查文件属性时。它是同步的，比 executeShellCommand 快，适合在自定义命令内部直接用。

---

### 2. executeShellCommand：跑命令

**它是什么**：shell 的对外入口。给它一串命令字符串，它返回 Promise，resolve 的值就是命令输出。

```js
const out = await window.executeShellCommand('ls /etc');
console.log(out);
// "hostname\ninit.d\npasswd\n..."
```

**命令里的一切都支持**：管道、重定向、变量、控制流、多行脚本：

```js
await window.executeShellCommand('echo hi | tr a-z A-Z'); // "HI"

await window.executeShellCommand('echo "name=$(whoami)"'); // "name=root"

await window.executeShellCommand(`
for i in 1 2 3; do
  echo "第 $i 个"
done
`);
// "第 1 个\n第 2 个\n第 3 个"
```

**返回值规则**（重要）：
- 有输出 → 返回输出字符串
- 重定向到文件（`echo hi > f`）→ 返回**空字符串**（输出进文件了）
- 命令不存在 → 返回 `sh: xxx: command not found`

**多行 vs 单行**：`executeShellCommand` 内部会自动把多行脚本切块分发。如果你只需要跑一行命令，也可以直接用 `window.wemlinux.shell.execute(cmd)`（单行执行器，更快，但别拿它跑 for/while 整块）。

```js
await window.wemlinux.shell.execute('echo single');  // "single"
```

> **什么时候用 executeShellCommand**：你要"像用户一样"执行命令、做集成测试、把 WemLinux 当脚本引擎时。

---

### 3. commandRouter 与 registerCommand：命令系统

**它是什么**：命令注册表。shell 每执行一条命令，都来这里查"有没有叫这个名字的处理函数"。

**先看它提供什么**：

```js
const r = window.commandRouter;
r.has('ls');                 // true —— 检查命令是否存在
r.registered;                // ["alias","awk","bash",...] 已注册命令名数组
r.getHandler('echo');        // 拿到 echo 的处理函数
```

**execute：跳过解析，直接调用命令**（参数要自己传数组）：

```js
await window.commandRouter.execute('echo', ['你好', '世界']);
// "你好 世界"
```

**registerCommand：注册你自己的命令**（核心玩法）：

```js
window.registerCommand('hi', (args) => {
  return '你好，' + (args.join(' ') || '陌生人') + '！';
});
```

注册完，立刻就能在 shell 里用了：

```js
await window.executeShellCommand('hi Evo'); // "你好，Evo！"
await window.executeShellCommand('hi');     // "你好，陌生人！"
```

**几点规则**：
- handler 收到的是 `args`：一个字符串数组，已经过**去引号、变量替换**处理
- 返回字符串 = 命令输出；返回空串 = 无输出
- handler 可以是 async 的（返回 Promise 也行）
- **同名覆盖**：后注册的生效，你可以用这招"魔改"内置命令：

```js
window.registerCommand('ls', (args) => '不给你看'); // 覆盖内置 ls
await window.executeShellCommand('ls /');          // "不给你看"
```

> **什么时候用**：给 WemLinux 加新功能、模拟外部程序、写插件时。这是三种注册方式里最推荐的一种。

---

### 4. safeResolvePath 与 getFileModeString

**safeResolvePath**：把用户输入的相对路径变成绝对路径，处理 `~`、`.`、`..`、`-`：

```js
window.safeResolvePath('~/doc.txt');            // "/home/user/doc.txt"
window.safeResolvePath('../etc/hostname');      // "/etc/hostname"（假设当前在 /home/user）
window.safeResolvePath('-');                    // 上一次的目录（cd - 语义）
```

**getFileModeString**：把 stat 里的 mode 数字转成 `ls -l` 那种权限字符串：

```js
window.getFileModeString('/etc/hostname'); // "-rw-r--r--"
window.getFileModeString('/etc');          // "drwxr-xr-x"
// 第一个字符：- 文件 / d 目录；后面 9 位：r 读 w 写 x 执行
```

---

### 5. _state：shell 的真身

**它是什么**：shell 内部所有状态的"实况转播"。你在命令里 `export`、`cd`、给变量赋值，改的都是这个对象。你可以直接读写它，效果和在 shell 里敲命令一样。

```js
window._state.cwd;               // 当前目录，如 "/"
window._state.env;               // 环境变量对象
window._state.vars;              // 用户变量（含 $1 位置参数）
window._state.aliases;           // 别名表
window._state.functions;         // 函数表
window._state.history;           // 命令历史数组
window._state.lastExitCode;      // 最后一条命令的退出码
window._state.oldpwd;            // 上一个目录
window._state.dirStack;          // pushd/popd 目录栈
window._state.jobs;              // 后台任务
```

**直接读写示例**：

```js
// 方式一：用 shell 命令改
await window.executeShellCommand('export FOO=bar');
window._state.env.FOO; // "bar"

// 方式二：直接改对象（等价！）
window._state.vars.MYFLAG = 'yes';
await window.executeShellCommand('echo $MYFLAG'); // "yes"

// 甚至可以直接改 cwd
window._state.cwd = '/etc';
await window.executeShellCommand('pwd'); // "/etc"
```

**另一个状态**：`window._sudoMode`（布尔）。`su`/`sudo` 输对密码后变 `true`，`rm` 等敏感命令才放行。

> **什么时候用 _state**：调试 shell 状态、在外部脚本里注入/读取变量、做状态同步时。注意：直接改 `_state.env` 不会自动加入 `exported` 列表，如果之后要 `export -p` 看到它，请用 `export` 命令或 `window.wemlinux.system.setenv`。

---

## 标准库教程（window.wemlinux.stdlib）

**它是什么**：专门给"命令开发者"准备的工具箱，六个子模块：`fs`、`path`、`io`、`sys`、`proc`、`utils`。它和 `system` 的区别：`system` 是给宿主环境（页面/机器人）用的底层接口，`stdlib` 是给你写命令时用的高层封装——**更短、更不易出错**。

先用一句话认识全部六个模块：

| 模块 | 一句话 | 常用场景 |
|------|--------|----------|
| `fs` | 文件读写删改查 | 命令要保存/读取数据 |
| `path` | 路径拼接与解析 | 拼路径、取文件名 |
| `io` | 输出到命令结果 | 命令要打印多行内容 |
| `sys` | 环境变量/目录/进程 | 命令要读环境、看当前目录 |
| `proc` | 命令注册/调用 | 注册命令、调用别的命令 |
| `utils` | 字符串/数字小工具 | 转义、格式化、补零 |

取用方式（推荐先存成短变量）：

```js
const { fs, path, io, sys, proc, utils } = window.wemlinux.stdlib;
```

---

### stdlib.fs：文件操作

**概念**：`fs` 是 webfs 的"安全封装"——每个方法都 try/catch 过，出错返回 `null`/`false` 而不是抛异常，写命令时不用到处写 try。

**读与写**（最核心）：

```js
fs.write('/tmp/log.txt', '第一行');     // true —— 写入
fs.read('/tmp/log.txt');                // "第一行" —— 读出
fs.append('/tmp/log.txt', '\n第二行');  // true —— 追加（不覆盖）
fs.read('/tmp/log.txt');
// "第一行\n第二行"

fs.read('/不存在的文件');               // null（不是抛异常！）
```

**存在与类型判断**：

```js
fs.exists('/tmp/log.txt');   // true
fs.isDir('/tmp');            // true
fs.isFile('/tmp/log.txt');   // true
fs.isFile('/tmp');           // false
```

**列目录**：

```js
fs.ls('/etc');
// [{name:"hostname", type:"file", size:13}, ...]
```

**创建、删除、改名**：

```js
fs.mkdir('/home/user/data');                       // true
fs.rename('/tmp/log.txt', '/home/user/data/a.txt'); // true —— 移动+改名一步到位
fs.rm('/home/user/data/a.txt');                    // true —— 删文件
// 注意：fs.rm 只删文件，删目录请用 webfs 或 rm -r 命令
```

**元信息与权限**：

```js
fs.stat('/etc/hostname');
// {mode:"0644", owner:"root", group:"root", size:13, mtime:..., type:"file"}

fs.chmod('/etc/hostname', '0755');  // true
fs.size('/etc/hostname');           // 13（字节）
```

**软链接三兄弟**：

```js
fs.symlink('/etc/hostname', '/tmp/hn');  // 创建
fs.isLink('/tmp/hn');                    // true
fs.readlink('/tmp/hn');                  // "/etc/hostname"
```

**完整示例——写一个"记账"命令的数据层**：

```js
function addRecord(amount, note) {
  const file = '/home/user/records.txt';
  const line = `${new Date().toISOString()} ${amount} ${note}`;
  if (fs.exists(file)) fs.append(file, '\n' + line);
  else fs.write(file, line);
}
addRecord(10, '买奶茶');
console.log(fs.read('/home/user/records.txt'));
// "2026-08-26T... 10 买奶茶"
```

---

### stdlib.path：路径处理

**概念**：文件系统只认绝对路径（`/a/b/c`），用户输入往往是 `~/x` 或 `../y`。`path` 帮你做转换和拼接，写命令必用。

**resolve —— 任何路径变绝对路径**：

```js
path.resolve('~/doc.txt');        // "/home/user/doc.txt"
path.resolve('../etc/hostname');  // 基于当前目录解析
```

**join —— 拼路径**（自动处理斜杠，不会多一个少一个）：

```js
path.join('/etc', 'init.d');      // "/etc/init.d"
path.join('/etc/', '/init.d');    // "/etc/init.d"（多余的 / 自动清理）
```

**拆解路径**：

```js
const p = '/usr/local/bin/run.sh';
path.basename(p);   // "run.sh"      —— 取最后一段
path.dirname(p);    // "/usr/local/bin" —— 取所在目录
path.extname(p);    // ".sh"         —— 取扩展名（含点）
```

**完整示例——写一个"确认后缀"的判断**：

```js
function isMarkdown(file) {
  return path.extname(file) === '.md';
}
isMarkdown('README.md');        // true
isMarkdown('wemlinux2.min.js'); // false
```

> 记住：**永远用 path 拼路径，不要手写字符串拼接**——手写 `'/home/' + name` 一旦 name 带 `..` 就会出安全问题，`resolve`/`join` 会帮你规范化。

---

### stdlib.io：往 shell 输出

**概念**：命令的处理函数返回一个字符串 = 输出。但复杂命令往往要输出很多行，还要混着错误输出。`io` 提供一个**缓冲机制**：先把内容写进缓冲，最后 `flush()` 一次性合并返回。

**核心三件套：println / err / flush**：

```js
async function statusCommand(args) {
  const io = window.wemlinux.stdlib.io;

  io.println('正在检查系统...');     // 普通输出（自动换行）
  io.out('CPU: 80%');               // 不换行输出
  io.err('警告：内存不足！');        // 错误输出（走 stderr 通道）

  return io.flush('最后一行');       // 合并所有输出并返回
}
```

调用 `statusCommand()` 的结果是：

```
正在检查系统...
CPU: 80%
警告：内存不足！
最后一行
```

**flush 的合并顺序**（记住这个规则）：`stdout 缓冲 → 返回值 → stderr 缓冲`，中间自动补换行。

**io 与直接 return 的区别**：

```js
// 方式 A：直接 return —— 简单，但只能一段话
return '结果: ' + data;

// 方式 B：io + flush —— 适合多行、混合错误信息
io.println('第1行');
io.println('第2行');
return io.flush();
```

**完整示例——给命令加进度条**：

```js
async function download(args) {
  const io = window.wemlinux.stdlib.io;
  const utils = window.wemlinux.stdlib.utils;

  for (let i = 0; i <= 10; i++) {
    io.out('\r下载中 ' + (i * 10) + '%');
    await new Promise(r => setTimeout(r, 50));
  }
  io.println('\n完成！大小: ' + utils.formatSize(1234567));
  return io.flush();
}
```

---

### stdlib.sys：环境与进程

**概念**：命令运行时想知道"我在哪个目录？PATH 里有啥？我是谁？"，就用 `sys`。它是 `system` 的薄封装。

**环境变量**：

```js
sys.getenv('HOME');              // "/home"
sys.setenv('MY_CFG', '123');     // true —— 设置后 shell 里能直接 $MY_CFG
sys.unsetenv('MY_CFG');          // true
sys.env();                       // 全部环境变量副本 {PATH:"/usr/bin:...", ...}
```

**当前目录与进程**：

```js
sys.cwd();                       // 当前工作目录，如 "/home/user"
sys.pid();                       // 进程 ID
sys.exit(3);                     // 设置退出码
sys.exitCode();                  // 3
```

**执行其他命令 / 找命令 / 延时**：

```js
await sys.exec('echo hello');    // 在命令里跑另一条命令（返回输出字符串）
sys.which('ls');                 // "/bin/ls" —— 按 PATH 找命令位置
await sys.sleep(1000);           // 等 1 秒
```

**完整示例——命令里读环境变量做配置**：

```js
async function deploy(args) {
  const sys = window.wemlinux.stdlib.sys;
  const mode = sys.getenv('DEPLOY_MODE') || 'dev';   // 没设置就默认 dev
  return '部署模式: ' + mode;
}
sys.setenv('DEPLOY_MODE', 'prod');
await deploy();   // "部署模式: prod"
```

---

### stdlib.proc：命令管理

**概念**：proc 让你**在运行时管理命令注册表**——注册、查询、调用、注销。它是 `registerCommand` 的完整版。

**注册与调用**：

```js
const proc = window.wemlinux.stdlib.proc;

proc.register('greet', (args) => 'Hi, ' + (args[0] || 'nobody') + '!');
proc.has('greet');                     // true
proc.list();                           // ["alias","awk",...,"greet"]
proc.get('greet');                     // 函数对象
await proc.execute('greet', ['Evo']);  // "Hi, Evo!"（直接调用，跳过 shell 解析）
```

**注销**：

```js
proc.unregister('greet');   // true —— 删掉后 shell 里就找不到它了
proc.has('greet');          // false
```

**完整示例——写一个"临时命令"用完即删**：

```js
// 生成一个一次性命令
const name = 'tmp_' + Date.now();
proc.register(name, () => '临时命令已运行');
await proc.execute(name, []);   // "临时命令已运行"
proc.unregister(name);          // 清理
```

> proc.register 和 window.registerCommand 效果一样，选哪个都行。区别：proc 在标准库里，写命令代码时不用跳出到全局。

---

### stdlib.utils：小工具

**概念**：写命令时高频用到的零碎函数，全部"拿来即用"。

```js
const utils = window.wemlinux.stdlib.utils;

utils.isNum('123');              // true —— 判断纯数字
utils.isNum('12a');              // false

utils.formatSize(1536);          // "1.50KB" —— 字节转人类可读
utils.formatSize(0);             // "0B"

utils.pad(7, 2);                 // "07" —— 补零
utils.pad('abc', 5);             // "00abc"

utils.esc('<b>&');               // "&lt;b&gt;&amp;" —— HTML 转义（防止注入）
utils.quote('say "hi"');         // "\"say \\\"hi\\\"\"" —— 加引号包裹

utils.now();                     // 时间戳毫秒
utils.random();                  // 0~1 随机数
```

**完整示例——格式化表格输出**：

```js
function printTable(rows) {
  const io = window.wemlinux.stdlib.io;
  const utils = window.wemlinux.stdlib.utils;

  rows.forEach(r => {
    io.println(
      utils.pad(r.id, 3) + '  ' +
      utils.pad(r.name, 10) + '  ' +
      utils.formatSize(r.size)
    );
  });
  return io.flush();
}
printTable([
  {id: 1, name: 'readme.md', size: 2048},
  {id: 2, name: 'main.js',   size: 55310}
]);
// "001  readme.md   2.00KB\n002  main.js     54.01KB"
```

---

## 实战：写一个完整的自定义命令

把前面学的串起来：注册一个 `todo` 命令，支持添加、列出、标记完成，用 `fs` 存数据、`path` 拼路径、`io` 输出、`proc` 注册。

```js
const { fs, path, io, proc } = window.wemlinux.stdlib;
const FILE = path.join('/home/user', 'todo.txt');   // 数据文件

proc.register('todo', async (args) => {
  const sub = args[0] || 'list';

  if (sub === 'add') {
    // 添加一条：追加一行 "[ ] 内容"
    const text = args.slice(1).join(' ');
    if (!text) { io.err('用法: todo add <内容>'); return io.flush(); }
    const old = fs.exists(FILE) ? fs.read(FILE) : '';
    fs.write(FILE, old + '[ ] ' + text + '\n');
    io.println('已添加: ' + text);

  } else if (sub === 'list') {
    // 列出所有：带编号
    if (!fs.exists(FILE)) { io.println('（还没有待办，试试 todo add 买奶茶）'); }
    else {
      fs.read(FILE).split('\n').filter(Boolean).forEach((line, i) => {
        io.println((i + 1) + '. ' + line);
      });
    }

  } else if (sub === 'done') {
    // 标记完成：把第 n 条的 [ ] 改成 [x]
    const n = parseInt(args[1], 10);
    const lines = fs.read(FILE).split('\n').filter(Boolean);
    if (!n || n < 1 || n > lines.length) { io.err('没有第 ' + args[1] + ' 条'); return io.flush(); }
    lines[n - 1] = lines[n - 1].replace('[ ]', '[x]');
    fs.write(FILE, lines.join('\n') + '\n');
    io.println('完成: ' + lines[n - 1]);
  }

  return io.flush();
});
```

现在打开 shell 试试（`executeShellCommand` 或页面里的终端都行）：

```bash
todo add 学完 WemLinux 教程
todo add 写一个自定义命令
todo list
# 1. [ ] 学完 WemLinux 教程
# 2. [ ] 写一个自定义命令
todo done 1
todo list
# 1. [x] 学完 WemLinux 教程
# 2. [ ] 写一个自定义命令
```

**这个例子用到的每个 API 都能对上号**：
- `path.join` —— 拼出数据文件路径，不怕目录写错
- `fs.exists / fs.read / fs.write` —— 读改写 todo 数据
- `io.println / io.err / io.flush` —— 输出结果，错误走 stderr
- `proc.register` —— 把命令挂进注册表，shell 立刻能用

---

## system 速览（__sys）

`window.wemlinux.system`（即 `__sys`）是更底层的接口，主要给**宿主环境**（页面脚本、机器人框架）用。写自定义命令优先用 stdlib，这里列出来备用：

| 分类 | API | 说明 |
|------|-----|------|
| 输入 | `system.stdin.read()` / `clear()` | 读取/清空管道输入（`/tmp/.pipe`） |
| 输出 | `system.stdout.write/writeln/buffer/reset/set(fn)` | stdout 缓冲与钩子 |
| 错误 | `system.stderr.write/writeln/buffer/reset/set(fn)` | stderr 缓冲与钩子 |
| 合并 | `system.flush(ret)` | stdout + 返回值 + stderr 合并 |
| 环境 | `system.setenv/getenv/env/unsetenv` | 环境变量（setenv 会同步 exported 列表） |
| 目录 | `system.cwd()` / `system.chdir(p)` | 当前目录/切换 |
| 参数 | `system.getargs(args, spec)` | 解析子命令/flags/options（见下方示例） |
| 异常 | `system.catch_excp(fn)` | 同步+异步统一捕获，返回 `{ok, value}` |
| 软链接 | `system.softlink.create/target/isLink/resolve` | 软链接全套 |
| 进程 | `system.pid()` / `system.exit(c)` / `system.exitCode()` | 进程与退出码 |
| 命令 | `system.which(cmd)` / `system.exec(cmd)` / `system.register(name, fn)` | 找命令/执行/注册 |
| 延时 | `system.sleep(ms)` | Promise 延时 |

**getargs 示例**（写需要参数的复杂命令时非常好用）：

```js
const sys = window.wemlinux.system;
const r = sys.getargs(['serve', '--port', '8080', '-v', 'file.txt'], {
  flags: ['v'],                       // 短旗标，无值
  options: ['port'],                  // 长选项，取值
  subcommands: ['serve', 'build']     // 子命令
});
// r.subcommand === "serve"
// r.options.port === "8080"
// r.flags.v === true
// r.positionals === ["file.txt"]
```

---

## 内置命令速查表

113 个内置命令，分类一览：

**文件与目录**：`ls` `cd` `pwd` `mkdir` `rm` `cp` `mv` `touch` `cat` `head` `tail` `chmod` `chown` `dir` `dirs` `pushd` `popd` `mount` `umount` `dd` `df`

**文本处理**：`echo` `printf` `sed` `awk` `grep` `sort` `uniq` `wc` `cut` `base64` `ed`

**Shell 内置**：`alias` `unalias` `export` `unset` `env` `set` `declare` `typeset` `readonly` `local` `printenv` `umask` `shift` `source` `.` `exec` `eval` `type` `command` `hash` `history` `help` `clear` `reset` `exit` `logout` `read` `let` `expr` `test` `[`

**控制流**：`if` `then` `else` `fi` `for` `while` `do` `done` `case` `esac` `break` `continue` `return` `function`

**进程与系统**：`ps` `top` `kill` `killall` `jobs` `bg` `fg` `nice` `sleep` `time` `times` `uptime` `free` `dmesg` `uname` `hostname` `last` `w` `who` `whoami` `id`

**网络（模拟）**：`ping` `curl` `wget` `ifconfig` `netstat` `nslookup`

**安全**：`sudo` `su` `passwd`

**其他**：`bash` `sh` `linux64` `date` `sha256sum` `yes`

在 shell 里输入 `help` 查看全部，`help <命令>` 查看单个命令用法。

---

## 浏览器要求与 License

- 支持：Chrome 57+ / Firefox 52+ / Edge 15+ / Safari 10.1+
- **不支持：IE 全系**
- License：MIT
