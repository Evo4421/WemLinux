# WemLinux Tutorial

WemLinux is a "mini Linux" that runs in your browser: it simulates a complete file system in memory (webfs), ships with a shell that supports pipes, redirection, variables, functions and control flow — all packed into **a single JS file**. This tutorial takes you from "running commands" to "writing your own commands, manipulating the file system, and using every API".

Current version: **wemlinux2 v2.4** (author: Evo, MIT License)

---

## Table of Contents

- [Step 1: Get WemLinux Running](#step-1-get-wemlinux-running)
- [Understand the Architecture: How the Four Pieces Fit Together](#understand-the-architecture-how-the-four-pieces-fit-together)
- [Basic API Tutorial (window.*)](#basic-api-tutorial-window)
  - [webfs: The Virtual File System](#1-webfs-the-virtual-file-system)
  - [executeShellCommand: Run Commands](#2-executeshellcommand-run-commands)
  - [commandRouter & registerCommand: The Command System](#3-commandrouter--registercommand-the-command-system)
  - [safeResolvePath & getFileModeString](#4-saferesolvepath--getfilemodestring)
  - [_state: The Shell's Real Body](#5-state-the-shells-real-body)
- [Standard Library Tutorial (window.wemlinux.stdlib)](#standard-library-tutorial-windowwemlinuxstdlib)
  - [stdlib.fs: File Operations](#stdlibfs-file-operations)
  - [stdlib.path: Path Handling](#stdlibpath-path-handling)
  - [stdlib.io: Output to the Shell](#stdlibio-output-to-the-shell)
  - [stdlib.sys: Environment & Process](#stdlibsys-environment--process)
  - [stdlib.proc: Command Management](#stdlibproc-command-management)
  - [stdlib.utils: Utilities](#stdlibutils-utilities)
- [Hands-On: Write a Complete Custom Command](#hands-on-write-a-complete-custom-command)
- [Virtual Processes & Signals (2.4 added)](#virtual-processes--signals-24-added)
- [system Overview (__sys)](#system-overview-sys)
- [Built-in Command Cheat Sheet](#built-in-command-cheat-sheet)
- [Browser Requirements & License](#browser-requirements--license)

---

## Step 1: Get WemLinux Running

Include the script in an HTML page and open the console:

```html
<!DOCTYPE html>
<html>
<body>
  <script src="wemlinux2.min.js"></script>
  <script>
    // Wait for the file system to initialize (the script loads IndexedDB data asynchronously)
    setTimeout(async () => {
      const out = await window.executeShellCommand('ls -la /etc');
      console.log(out);
    }, 300);
  </script>
</body>
</html>
```

You should see something like:

```
-rw-r--r-- root root 0 hostname
drwxr-xr-x root root 0 init.d
...
```

> Want results earlier? `window.webfs` is synchronous — no waiting needed:
> ```js
> console.log(window.webfs.read('/etc/hostname')); // "humminglinux"
> ```

---

## Understand the Architecture: How the Four Pieces Fit Together

WemLinux is built from four layers. Once you see how they cooperate, nothing else is confusing:

```
┌────────────────────────────────────────────────────────┐
│ ① webfs — File System                                  │
│    A tree in memory: /bin, /etc, /home/user...         │
│    All file-reading/writing APIs live here             │
├────────────────────────────────────────────────────────┤
│ ② shell — Command Interpreter                          │
│    Splits "ls -la /etc" into command + args, then      │
│    looks up the handler in ③                           │
│    Handles pipes | redirection > variables $x control  │
├────────────────────────────────────────────────────────┤
│ ③ commandRouter — Command Registry                     │
│    A table: command name → handler function.           │
│    All 113 built-in commands are registered here.      │
│    You can add your own too (registerCommand).         │
├────────────────────────────────────────────────────────┤
│ ④ system / stdlib — Public Interfaces                  │
│    The toolbox for writing commands: system is aimed   │
│    at the host environment, stdlib at command          │
│    developers (the focus of this tutorial).            │
└────────────────────────────────────────────────────────┘
```

**One-liner to remember**: the shell "talks", the commandRouter "finds someone to do the job", webfs "stores things", and stdlib is "your toolbox".

**⑤ Virtual Processes (2.4 added)**: Starting with v2.4, WemLinux gains a layer of **virtual processes** — the first-class citizen and the most important concept of the whole system. webfs manages "storing things", while virtual processes manage "doing work": running multiple programs at once, sending signals to control them, pausing/resuming/killing them. There is a dedicated chapter later in this tutorial.

Now let's start from the bottom — webfs — and work our way up.

---

## Basic API Tutorial (window.*)

### 1. webfs: The Virtual File System

**What it is**: a file tree living in memory, rooted at `/`, pre-populated with `/bin`, `/etc`, `/home/user`, `/tmp` and more. Every `ls` or `cat` command operates on this tree.

**Read & write** (the two you'll use most):

```js
// Write: parent directories are auto-created if missing
window.webfs.write('/tmp/note.txt', 'Hello WemLinux');

// Read
const text = window.webfs.read('/tmp/note.txt');
console.log(text); // "Hello WemLinux"
```

**Check existence / type**:

```js
window.webfs.fileExist('/tmp/note.txt'); // true
window.webfs.fileExist('/tmp/nope.txt'); // false
window.webfs.isDir('/etc');              // true
window.webfs.isDir('/tmp/note.txt');     // false
```

**List a directory**:

```js
window.webfs.getFileList('/etc');
// [{name:"hostname", type:"file", size:13}, {name:"passwd", type:"file", ...}, ...]
```

**Directory operations**:

```js
window.webfs.mkdir('/home/user/projects');                       // create dir
window.webfs.rename('/tmp/note.txt', '/home/user/projects/note.md'); // move/rename
window.webfs.delFile('/home/user/projects/note.md');             // delete file
```

**Metadata & permissions**:

```js
const st = window.webfs.stat('/etc/hostname');
// {mode:"0644", owner:"root", group:"root", size:13, mtime:..., type:"file"}

window.webfs.chmod('/etc/hostname', '0755');   // make it executable
// Note: mode is a 4-char string; the first char is ignored, the last 3 take effect
```

**Symlinks** (like `ln -s` on Linux):

```js
window.webfs.symlink('/etc/hostname', '/tmp/hn');  // /tmp/hn → /etc/hostname
window.webfs.read('/tmp/hn');       // auto-resolves → "humminglinux"
window.webfs.isLink('/tmp/hn');     // true
window.webfs.readlink('/tmp/hn');   // "/etc/hostname"
```

**Persistence** (a wemlinux2 feature):

```js
await window.webfs.save();   // persist the whole tree to IndexedDB
await window.webfs.load();   // restore it next time the page opens
```

**Path normalization**:

```js
window.webfs.normalizePath('/a/./b/../c'); // "/a/c"
```

> **When to use webfs**: whenever you read/write files or inspect file attributes. It's synchronous (faster than executeShellCommand) and perfect inside custom commands.

---

### 2. executeShellCommand: Run Commands

**What it is**: the shell's front door. Give it a command string, it returns a Promise whose resolved value is the command output.

```js
const out = await window.executeShellCommand('ls /etc');
console.log(out);
// "hostname\ninit.d\npasswd\n..."
```

**Everything inside commands is supported**: pipes, redirection, variables, control flow, multi-line scripts:

```js
await window.executeShellCommand('echo hi | tr a-z A-Z'); // "HI"

await window.executeShellCommand('echo "name=$(whoami)"'); // "name=root"

await window.executeShellCommand(`
for i in 1 2 3; do
  echo "item $i"
done
`);
// "item 1\nitem 2\nitem 3"
```

**Return value rules** (important):
- With output → returns the output string
- Redirected to a file (`echo hi > f`) → returns an **empty string** (output went to the file)
- Unknown command → returns `sh: xxx: command not found`

**Multi-line vs single-line**: `executeShellCommand` automatically chunks multi-line scripts for you. If you only need one line, `window.wemlinux.shell.execute(cmd)` is a faster single-line executor — but don't run a whole `for`/`while` block through it.

```js
await window.wemlinux.shell.execute('echo single');  // "single"
```

> **When to use executeShellCommand**: when you want to "act like a user" — running commands, integration tests, or using WemLinux as a scripting engine.

---

### 3. commandRouter & registerCommand: The Command System

**What it is**: the command registry. Every time the shell runs a command, it looks here for "a handler named X".

**What it offers**:

```js
const r = window.commandRouter;
r.has('ls');                 // true — does the command exist?
r.registered;                // ["alias","awk","bash",...] all registered names
r.getHandler('echo');        // the handler function for echo
```

**execute: call a command directly, skipping parsing** (pass args as an array yourself):

```js
await window.commandRouter.execute('echo', ['Hello', 'World']);
// "Hello World"
```

**registerCommand: register your own command** (the core play):

```js
window.registerCommand('hi', (args) => {
  return 'Hello, ' + (args.join(' ') || 'stranger') + '!';
});
```

Instantly usable from the shell:

```js
await window.executeShellCommand('hi Evo'); // "Hello, Evo!"
await window.executeShellCommand('hi');     // "Hello, stranger!"
```

**Rules to remember**:
- The handler receives `args`: a **string array**, already processed (quotes stripped, variables expanded)
- Returning a string = command output; returning `""` = no output
- Handlers may be `async` (returning a Promise works too)
- **Same-name override**: the later registration wins — you can even "mod" built-ins:

```js
window.registerCommand('ls', (args) => 'Not telling you'); // overrides built-in ls
await window.executeShellCommand('ls /');                  // "Not telling you"
```

> **When to use**: adding features, simulating external programs, or writing plugins. This is the most recommended way to register commands.

---

### 4. safeResolvePath & getFileModeString

**safeResolvePath**: turns a user-relative path into an absolute one, handling `~`, `.`, `..`, `-`:

```js
window.safeResolvePath('~/doc.txt');            // "/home/user/doc.txt"
window.safeResolvePath('../etc/hostname');      // "/etc/hostname" (if cwd is /home/user)
window.safeResolvePath('-');                    // the previous directory (cd - semantics)
```

**getFileModeString**: converts the numeric mode from `stat` into an `ls -l`-style permission string:

```js
window.getFileModeString('/etc/hostname'); // "-rw-r--r--"
window.getFileModeString('/etc');          // "drwxr-xr-x"
// First char: - file / d directory; next 9 chars: r read, w write, x execute
```

---

### 5. _state: The Shell's Real Body

**What it is**: a live feed of all internal shell state. When you `export`, `cd`, or assign variables in commands, you're mutating this object. You can read **and write** it directly — same effect as typing commands.

```js
window._state.cwd;               // current directory, e.g. "/"
window._state.env;               // environment variables object
window._state.vars;              // user variables (incl. $1 positional params)
window._state.aliases;           // alias table
window._state.functions;         // function table
window._state.history;           // command history array
window._state.lastExitCode;      // exit code of the last command
window._state.oldpwd;            // previous directory
window._state.dirStack;          // pushd/popd directory stack
window._state.jobs;              // background jobs
```

**Read/write examples**:

```js
// Way 1: change via shell command
await window.executeShellCommand('export FOO=bar');
window._state.env.FOO; // "bar"

// Way 2: mutate the object directly (equivalent!)
window._state.vars.MYFLAG = 'yes';
await window.executeShellCommand('echo $MYFLAG'); // "yes"

// You can even change cwd directly
window._state.cwd = '/etc';
await window.executeShellCommand('pwd'); // "/etc"
```

**Another piece of state**: `window._sudoMode` (boolean). It becomes `true` after `su`/`sudo` verifies the password; sensitive commands like `rm` require it.

> **When to use _state**: debugging shell state, injecting/reading variables from outside, state synchronization. Note: mutating `_state.env` directly does NOT update the `exported` list automatically — use the `export` command or `window.wemlinux.system.setenv` if you need `export -p` to see it.

---

## Standard Library Tutorial (window.wemlinux.stdlib)

**What it is**: a toolbox made **for command developers**, with six modules: `fs`, `path`, `io`, `sys`, `proc`, `utils`. The difference from `system`: `system` is the low-level interface for the **host environment** (pages, bot frameworks); `stdlib` is the high-level wrapper **for you writing commands** — shorter and harder to get wrong.

Meet all six modules in one glance:

| Module | One-liner | Typical use |
|--------|-----------|-------------|
| `fs` | File read/write/delete/inspect | Command needs to persist/load data |
| `path` | Path join & parse | Joining paths, extracting filenames |
| `io` | Output to the command result | Command prints multiple lines |
| `sys` | Env vars / cwd / process | Read env, see current dir |
| `proc` | Register / invoke commands + virtual processes | Register/call commands, spawn processes (2.4 added) |
| `utils` | String/number helpers | Escaping, formatting, zero-padding |

Grab them (short names are handy):

```js
const { fs, path, io, sys, proc, utils } = window.wemlinux.stdlib;
```

---

### stdlib.fs: File Operations

**Concept**: `fs` is a "safe wrapper" around webfs — every method is try/caught, returning `null`/`false` on failure instead of throwing. You don't need try/catch in your commands.

**Read & write** (the core):

```js
fs.write('/tmp/log.txt', 'First line');     // true — write
fs.read('/tmp/log.txt');                    // "First line" — read
fs.append('/tmp/log.txt', '\nSecond line'); // true — append (no overwrite)
fs.read('/tmp/log.txt');
// "First line\nSecond line"

fs.read('/nonexistent/file');               // null (NOT an exception!)
```

**Existence & type checks**:

```js
fs.exists('/tmp/log.txt');   // true
fs.isDir('/tmp');            // true
fs.isFile('/tmp/log.txt');   // true
fs.isFile('/tmp');           // false
```

**List a directory**:

```js
fs.ls('/etc');
// [{name:"hostname", type:"file", size:13}, ...]
```

**Create, delete, rename**:

```js
fs.mkdir('/home/user/data');                        // true
fs.rename('/tmp/log.txt', '/home/user/data/a.txt'); // true — move + rename in one step
fs.rm('/home/user/data/a.txt');                     // true — delete file
// Note: fs.rm only deletes files. For directories use webfs or the rm -r command.
```

**Metadata & permissions**:

```js
fs.stat('/etc/hostname');
// {mode:"0644", owner:"root", group:"root", size:13, mtime:..., type:"file"}

fs.chmod('/etc/hostname', '0755');  // true
fs.size('/etc/hostname');           // 13 (bytes)
```

**The symlink trio**:

```js
fs.symlink('/etc/hostname', '/tmp/hn');  // create
fs.isLink('/tmp/hn');                    // true
fs.readlink('/tmp/hn');                  // "/etc/hostname"
```

**Full example — data layer for a "ledger" command**:

```js
function addRecord(amount, note) {
  const file = '/home/user/records.txt';
  const line = `${new Date().toISOString()} ${amount} ${note}`;
  if (fs.exists(file)) fs.append(file, '\n' + line);
  else fs.write(file, line);
}
addRecord(10, 'bubble tea');
console.log(fs.read('/home/user/records.txt'));
// "2026-08-26T... 10 bubble tea"
```

---

### stdlib.path: Path Handling

**Concept**: the file system only accepts absolute paths (`/a/b/c`), but user input is often `~/x` or `../y`. `path` converts and joins for you — a must when writing commands.

**resolve — any path → absolute**:

```js
path.resolve('~/doc.txt');        // "/home/user/doc.txt"
path.resolve('../etc/hostname');  // resolved against the current directory
```

**join — concatenate paths** (handles slashes automatically):

```js
path.join('/etc', 'init.d');      // "/etc/init.d"
path.join('/etc/', '/init.d');    // "/etc/init.d" (extra slashes cleaned)
```

**Break a path apart**:

```js
const p = '/usr/local/bin/run.sh';
path.basename(p);   // "run.sh"           — last segment
path.dirname(p);    // "/usr/local/bin"   — containing directory
path.extname(p);    // ".sh"              — extension (with dot)
```

**Full example — "check the extension"**:

```js
function isMarkdown(file) {
  return path.extname(file) === '.md';
}
isMarkdown('README.md');        // true
isMarkdown('wemlinux2.min.js'); // false
```

> Remember: **always use path to build paths, never hand-rolled string concatenation** — a naive `'/home/' + name` breaks or becomes a security issue the moment `name` contains `..`. `resolve`/`join` normalize for you.

---

### stdlib.io: Output to the Shell

**Concept**: a command's handler returns one string = its output. But real commands often need many lines, mixed with error output. `io` gives you a **buffer mechanism**: write into the buffer first, then merge everything with `flush()` at the end.

**The core trio: println / err / flush**:

```js
async function statusCommand(args) {
  const io = window.wemlinux.stdlib.io;

  io.println('Checking system...');   // normal output (auto newline)
  io.out('CPU: 80%');                 // output without newline
  io.err('WARNING: low memory!');     // error output (stderr channel)

  return io.flush('Final line');      // merge everything and return
}
```

Calling `statusCommand()` produces:

```
Checking system...
CPU: 80%
WARNING: low memory!
Final line
```

**flush merge order** (memorize this): `stdout buffer → return value → stderr buffer`, newlines inserted automatically.

**io vs plain return**:

```js
// Way A: plain return — simple, but one blob of text
return 'Result: ' + data;

// Way B: io + flush — for multi-line output with mixed errors
io.println('Line 1');
io.println('Line 2');
return io.flush();
```

**Full example — a progress bar command**:

```js
async function download(args) {
  const io = window.wemlinux.stdlib.io;
  const utils = window.wemlinux.stdlib.utils;

  for (let i = 0; i <= 10; i++) {
    io.out('\rDownloading ' + (i * 10) + '%');
    await new Promise(r => setTimeout(r, 50));
  }
  io.println('\nDone! Size: ' + utils.formatSize(1234567));
  return io.flush();
}
```

---

### stdlib.sys: Environment & Process

**Concept**: when a command needs to know "which directory am I in? what's in PATH? who am I?", use `sys`. It's a thin wrapper over `system`.

**Environment variables**:

```js
sys.getenv('HOME');              // "/home"
sys.setenv('MY_CFG', '123');     // true — shell can now use $MY_CFG
sys.unsetenv('MY_CFG');          // true
sys.env();                       // a copy of all env vars {PATH:"/usr/bin:...", ...}
```

**Current directory & process**:

```js
sys.cwd();                       // current working dir, e.g. "/home/user"
sys.pid();                       // process ID
sys.exit(3);                     // set exit code
sys.exitCode();                  // 3
```

**Run other commands / find a command / delay**:

```js
await sys.exec('echo hello');    // run another command from inside (returns output string)
sys.which('ls');                 // "/bin/ls" — locate a command via PATH
await sys.sleep(1000);           // wait 1 second
```

**Full example — config from env with a default**:

```js
async function deploy(args) {
  const sys = window.wemlinux.stdlib.sys;
  const mode = sys.getenv('DEPLOY_MODE') || 'dev';   // fallback if unset
  return 'Deploy mode: ' + mode;
}
sys.setenv('DEPLOY_MODE', 'prod');
await deploy();   // "Deploy mode: prod"
```

---

### stdlib.proc: Command Management

**Concept**: `proc` lets you **manage the command registry at runtime** — register, query, invoke, unregister. It's the full version of `registerCommand`.

**Register & invoke**:

```js
const proc = window.wemlinux.stdlib.proc;

proc.register('greet', (args) => 'Hi, ' + (args[0] || 'nobody') + '!');
proc.has('greet');                     // true
proc.list();                           // ["alias","awk",...,"greet"]
proc.get('greet');                     // the function object
await proc.execute('greet', ['Evo']);  // "Hi, Evo!" (direct call, no shell parsing)
```

**Unregister**:

```js
proc.unregister('greet');   // true — after this the shell can't find it
proc.has('greet');          // false
```

**Full example — a one-shot command, deleted after use**:

```js
const name = 'tmp_' + Date.now();
proc.register(name, () => 'one-shot command ran');
await proc.execute(name, []);   // "one-shot command ran"
proc.unregister(name);          // cleanup
```

> `proc.register` and `window.registerCommand` do the same thing — pick either. The difference: proc lives inside the standard library, so command code doesn't have to jump out to the global scope.
>
> **v2.4 addition: proc is also the entry point to virtual processes** — `proc.spawn` / `proc.kill` / `proc.list` / `proc.get` / `proc.count` / `proc.limits` / `proc.setLimit`. See the "Virtual Processes & Signals" chapter below.

---

### stdlib.utils: Utilities

**Concept**: small high-frequency helpers for writing commands. Grab-and-go.

```js
const utils = window.wemlinux.stdlib.utils;

utils.isNum('123');              // true — pure digits?
utils.isNum('12a');              // false

utils.formatSize(1536);          // "1.50KB" — bytes → human readable
utils.formatSize(0);             // "0B"

utils.pad(7, 2);                 // "07" — zero-pad
utils.pad('abc', 5);             // "00abc"

utils.esc('<b>&');               // "&lt;b&gt;&amp;" — HTML escape (injection guard)
utils.quote('say "hi"');         // "\"say \\\"hi\\\"\"" — wrap in quotes

utils.now();                     // timestamp in ms
utils.random();                  // random 0~1
```

**Full example — formatted table output**:

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

## Hands-On: Write a Complete Custom Command

Let's tie it all together: register a `todo` command that supports add / list / done, persisting data with `fs`, building paths with `path`, printing with `io`, and registering with `proc`.

```js
const { fs, path, io, proc } = window.wemlinux.stdlib;
const FILE = path.join('/home/user', 'todo.txt');   // data file

proc.register('todo', async (args) => {
  const sub = args[0] || 'list';

  if (sub === 'add') {
    // Add an item: append a "[ ] text" line
    const text = args.slice(1).join(' ');
    if (!text) { io.err('Usage: todo add <text>'); return io.flush(); }
    const old = fs.exists(FILE) ? fs.read(FILE) : '';
    fs.write(FILE, old + '[ ] ' + text + '\n');
    io.println('Added: ' + text);

  } else if (sub === 'list') {
    // List all items with numbers
    if (!fs.exists(FILE)) { io.println('(nothing yet — try: todo add bubble tea)'); }
    else {
      fs.read(FILE).split('\n').filter(Boolean).forEach((line, i) => {
        io.println((i + 1) + '. ' + line);
      });
    }

  } else if (sub === 'done') {
    // Mark item #n as done: [ ] → [x]
    const n = parseInt(args[1], 10);
    const lines = fs.read(FILE).split('\n').filter(Boolean);
    if (!n || n < 1 || n > lines.length) { io.err('No item #' + args[1]); return io.flush(); }
    lines[n - 1] = lines[n - 1].replace('[ ]', '[x]');
    fs.write(FILE, lines.join('\n') + '\n');
    io.println('Done: ' + lines[n - 1]);
  }

  return io.flush();
});
```

Now try it from the shell (via `executeShellCommand` or the in-page terminal):

```bash
todo add finish WemLinux tutorial
todo add write a custom command
todo list
# 1. [ ] finish WemLinux tutorial
# 2. [ ] write a custom command
todo done 1
todo list
# 1. [x] finish WemLinux tutorial
# 2. [ ] write a custom command
```

**Every API in this example maps to its role**:
- `path.join` — builds the data file path safely
- `fs.exists / fs.read / fs.write` — read/modify/write todo data
- `io.println / io.err / io.flush` — output results, errors via stderr
- `proc.register` — hangs the command into the registry, immediately usable in the shell

---

## Virtual Processes & Signals (2.4 added)

Starting with v2.4, WemLinux introduces **virtual processes** — the **first-class citizen** and the most important concept of the whole system. They let the shell genuinely run multiple programs "at the same time", control their life & death, pause and resume, all backed by a complete **signal mechanism**. If webfs is where things are "stored", virtual processes are where work "happens".

### Spawning a Virtual Process

`stdlib.proc.spawn` creates a virtual process. It returns an object carrying a `pid` (process ID); the process keeps its own `status`, `cwd`, `started` time, and more:

```js
const proc = window.wemlinux.stdlib.proc;

// Create a virtual process named "myjob"
const r = proc.spawn('myjob', (p) => {
  console.log('process ' + p.pid + ' started');
  return new Promise(res => setTimeout(() => { console.log('job done'); res(); }, 1000));
});
// r => { ok: true, pid: 2, proc: { pid:2, name:"myjob", status:"running", ... } }
```

- `fn` is the work the process performs; it receives the process object `p`. If it returns a Promise, the process automatically becomes `exited` when it resolves.
- `proc.list()` lists all active processes; `proc.get(pid)` looks one up by pid; `proc.count()` returns the active count.
- `proc.kill(pid)` terminates a process.

**Process state machine**: `running` → `stopped` (via STOP) → `exited`. `exited` and `zombie` are not active and won't appear in `proc.list()`.

### Listing Processes & `ps`

```js
proc.list();
// [{ pid:2, name:"myjob", status:"running", active:true, cwd:"/", started:..., exitCode:0, mem:0 }, ...]
```

Use `ps` in the shell to view all processes, or `top` for a monitoring view.

### The Signal System

Signals are the "secret codes" of inter-process communication. WemLinux supports a full set: `SIGHUP(1)` `SIGINT(2)` `SIGQUIT(3)` … `SIGKILL(9)` `SIGTERM(15)` `SIGCONT(18)` `SIGSTOP(19)`, etc.

**Send signals: the `kill` command**

```bash
sleep 100 &        # background task → [1] 1234
kill -9 1234       # force kill (SIGKILL)
kill -TERM 1234    # graceful terminate (SIGTERM)
kill -19 1234      # pause (SIGSTOP)
kill -18 1234      # continue (SIGCONT)
kill -l            # list all signals
```

**Catch signals: the `trap` command** — attach a command to a signal, run it when received:

```bash
trap 'echo interrupted' INT   # catch INT (Ctrl-C)
trap - INT                    # clear it
trap -l                       # list signals
```

**Listen in code** (`stdlib.sys.signal`):

```js
const sys = window.wemlinux.stdlib.sys;
sys.signal.on('INT', () => console.log('I was Ctrl-C\\'d'));
sys.signal.off('INT');   // remove the listener
sys.signal.list();       // ["SIGINT", ...]
```

### Job Control: background `&`, jobs, bg/fg, wait

```bash
sleep 3 &          # run in background → [1] 1234
jobs               # show Running / Done
wait               # wait for all background jobs to finish
fg                 # bring a background job to the foreground
bg                 # resume a paused background job
```

### Resource Limits: ulimit

Limit how many virtual processes can run at once, so nothing gets out of hand:

```bash
ulimit -n          # show the soft limit (default 256)
ulimit -a          # show soft & hard
ulimit -n 300      # set soft to 300 (cannot exceed hard)
```

```js
proc.limits();          // { soft:256, hard:512 }
proc.setLimit(300, 700);// set soft & hard together
proc.setLimit(900, 700);// false — soft cannot exceed hard
```

Beyond the soft limit, `spawn` is rejected: `{ ok:false, error:"resource temporarily unavailable", limit:256 }`.

### Subshells & exec Replacement

```bash
( cd /etc && pwd )   # cd inside a subshell; parent dir unaffected on exit
exec bash            # replace the current shell with bash
exec -l sh           # login-style replacement
```

### Restricted Execution: the `jsc` Command (2.4 added)

`jsc` is a **safe** JS runner: it forbids touching HTML (40+ DOM globals such as `document`/`window`/`navigator` are all blocked), allowing only JS syntax plus the wemlinux2 standard library. Perfect for running untrusted scripts:

```bash
jsc "1+1"                                      # 2 — expressions print directly
jsc "typeof document"                          # undefined — can't touch DOM
jsc "module.exports=function(a){return a[0]}"  hello   # hello
jsc /path/to/script.js                          # run a .js file (restricted)
```

Meanwhile `source` / `.` can now also load `.js` files — and, exactly like executables, run them **fully open** (no DOM restrictions):

```bash
source my.js     # fully-open JS execution
. my.js          # equivalent
```

### Shell Engine Enhancements (2.4 added)

v2.4 also upgraded the command parser:

- **Multi-line blocks**: `if/while/for/case/function` can now span multiple lines
- **Command substitution `$()`**: supports spaces, nesting and concatenation (`a$(echo b)c`)
- **test logical operators**: `!` / `-a` / `-o`, plus `==`
- **`&&` / `||` fix**: no longer misdetected as background jobs
- **Single vs double quotes** now match bash: single quotes don't expand variables/`$()`, double quotes do

---

## system Overview (__sys)

`window.wemlinux.system` (a.k.a. `__sys`) is the lower-level interface, mainly for the **host environment** (page scripts, bot frameworks). Prefer stdlib inside custom commands; keep this for reference:

| Category | API | Description |
|----------|-----|-------------|
| Input | `system.stdin.read()` / `clear()` | Read/clear pipe input (`/tmp/.pipe`) |
| Output | `system.stdout.write/writeln/buffer/reset/set(fn)` | stdout buffer & hook |
| Error | `system.stderr.write/writeln/buffer/reset/set(fn)` | stderr buffer & hook |
| Merge | `system.flush(ret)` | stdout + return + stderr merged |
| Env | `system.setenv/getenv/env/unsetenv` | env vars (setenv also updates `exported`) |
| Cwd | `system.cwd()` / `system.chdir(p)` | current dir / switch |
| Args | `system.getargs(args, spec)` | parse subcommands/flags/options (example below) |
| Exceptions | `system.catch_excp(fn)` | sync+async unified capture → `{ok, value}` |
| Symlink | `system.softlink.create/target/isLink/resolve` | full symlink support |
| Process | `system.pid()` / `system.exit(c)` / `system.exitCode()` | process & exit codes |
| Virtual proc (2.4) | `proc.spawn(name,fn)` / `proc.kill(pid)` / `proc.list()` / `proc.limits()` | create/kill/list virtual processes, view limits |
| Signals (2.4) | `system.signal.on(sig,fn)` / `off` / `list`; `window.emitSig(sig)` | listen/remove signals, emit a signal |
| Commands | `system.which(cmd)` / `system.exec(cmd)` / `system.register(name, fn)` | locate/execute/register |
| Delay | `system.sleep(ms)` | Promise-based sleep |

**getargs example** (great for commands with complex arguments):

```js
const sys = window.wemlinux.system;
const r = sys.getargs(['serve', '--port', '8080', '-v', 'file.txt'], {
  flags: ['v'],                       // short flags, no value
  options: ['port'],                  // long options, take a value
  subcommands: ['serve', 'build']     // subcommands
});
// r.subcommand === "serve"
// r.options.port === "8080"
// r.flags.v === true
// r.positionals === ["file.txt"]
```

---

## Built-in Command Cheat Sheet

113 built-in commands, categorized:

**Files & directories**: `ls` `cd` `pwd` `mkdir` `rm` `cp` `mv` `touch` `cat` `head` `tail` `chmod` `chown` `dir` `dirs` `pushd` `popd` `mount` `umount` `dd` `df`

**Text processing**: `echo` `printf` `sed` `awk` `grep` `sort` `uniq` `wc` `cut` `base64` `ed`

**Shell built-ins**: `alias` `unalias` `export` `unset` `env` `set` `declare` `typeset` `readonly` `local` `printenv` `umask` `shift` `source` `.` `exec` `eval` `type` `command` `hash` `history` `help` `clear` `reset` `exit` `logout` `read` `let` `expr` `test` `[`

**Control flow**: `if` `then` `else` `fi` `for` `while` `do` `done` `case` `esac` `break` `continue` `return` `function`

**Process & system**: `ps` `top` `kill` `killall` `jobs` `bg` `fg` `wait` `nice` `sleep` `time` `times` `uptime` `free` `dmesg` `uname` `hostname` `last` `w` `who` `whoami` `id`
　　(v2.4 enhanced: `kill` supports `-9/-TERM/-19/-18/-l`, new `trap`, `ulimit`)

**Restricted execution (2.4 added)**: `jsc` (safe JS, no HTML access)

**Network (simulated)**: `ping` `curl` `wget` `ifconfig` `netstat` `nslookup`

**Security**: `sudo` `su` `passwd`

**Other**: `bash` `sh` `linux64` `date` `sha256sum` `yes`

Type `help` in the shell for the full list, `help <command>` for a single command's usage.

---

## Browser Requirements & License

- Supported: Chrome 57+ / Firefox 52+ / Edge 15+ / Safari 10.1+
- **Not supported: Internet Explorer (all versions)**
- License: MIT
