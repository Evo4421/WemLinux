# WemLinux

> WemLinux is a lightweight Linux simulation environment running in the browser (HummingLinux), consisting of webfs (virtual file system) + wemlinux shell (a shell interpreter with 121 built-in commands), all integrated into a single JS file. Simply include it in your browser and start using it.

· Author: Evo
· Studio: LingHan Technology

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WemLinux</title>
</head>
<body>
  <input id="shell-input" placeholder="Enter command, press Enter to execute">
  <pre id="shell-output"></pre>
  <script src="wemlinux.js"></script> // or wemlinux2.js
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

After importing wemlinux.js, the environment initializes automatically:

· File system: standard directory tree including /bin /dev /etc /home /proc /system /tmp /usr /var, etc.
· Pre-installed files: /etc/hostname (humminglinux), /etc/motd, /etc/passwd, /home/user/README.txt
· Environment variables: PATH / HOME / TERMINAL / SHELL / USER / HOSTNAME

---

### External API Documentation

WemLinux exposes the following APIs on window:

**window.executeShellCommand(command)**

Execute a shell command (supports pipes, redirections, variables, control flow).

Parameter Type Description
command string The command string to execute

Returns Promise<string> — command output. Returns an empty string when output is redirected to a file.

```js
await window.executeShellCommand('ls -la /etc');
// "-rw-r--r-- root root        0 hostname\ndrwxr-xr-x ..."
```

**window.handleCommand(command)**

Alias for executeShellCommand, identical in behavior.

**window.commandRouter**

Command router object containing all registered commands:

Method Description
commandRouter.register(name, handler) Register a command
commandRouter.getHandler(name) Retrieve a command handler
commandRouter.has(name) Check if a command exists
commandRouter.execute(name, args) Execute a command directly (skips parsing)
commandRouter.registered Array of registered command names

**window.registerCommand(name, handler)**

External command injection API — allows adding new commands without modifying the source code.

Parameter Type Description
name string Command name (letters/digits/underscores)
handler Function (args: string[]) => string \| Promise<string>

Returns boolean — whether registration succeeded.

```js
window.registerCommand('hello', (args) => 'Hello, ' + (args.join(' ') || 'world') + '!');

await window.executeShellCommand('hello Evo'); // "Hello, Evo!"
```

Existing commands can be overridden (the later registration takes effect).

**window.safeResolvePath(path)**

Resolves a path, supporting ~, -, ., .. syntax, returning an absolute path.

```js
window.safeResolvePath('~/documents/file.txt'); // "/home/user/documents/file.txt"
```

window.getFileModeString(path)

Gets the file permission string (used by ls -l, etc.).

```js
window.getFileModeString('/etc/hostname'); // "-rw-r--r--"
window.getFileModeString('/etc');          // "drwxr-xr-x"
```

**window.webfs**

webfs virtual file system object (pure in-memory tree structure, zero dependencies):

Method Description
webfs.read(path) Read file content (symlinks automatically resolved)
webfs.write(path, content) Write to a file
webfs.delFile(path) Delete a file
webfs.fileExist(path) Check if a file exists
webfs.isDir(path) Check if path is a directory
webfs.getFileList(path) List directory entries [{name, type, size}]
webfs.getFileSize(path) Get file size
webfs.mkdir(path) Create directory (supports -p recursive)
webfs.rename(old, new) Rename/move
webfs.stat(path) Get file metadata {type, mode, size}
webfs.chmod(path, mode) Change permissions
webfs.exists(path) Check if path exists
webfs.normalizePath(path) Normalize path
webfs.exit() Clean up environment

window._state

### Global state object:

```js
{
  cwd: "/",          // Current working directory
  pid: "12345",      // Process ID
  env: {...},        // Environment variables
  vars: {...},       // User variables
  aliases: {...},    // Aliases
  history: [...],    // Command history
  lastOutput: "",    // Last output
  lastExitCode: 0,   // Last exit code
  oldpwd: "/",       // Previous directory (cd -)
  dirStack: [],      // Directory stack (pushd/popd)
  functions: {},     // Shell functions
  jobs: [],          // Background jobs
  ulimit: {...}      // Resource limits
}
```

**window._sudoMode**

Boolean value indicating whether in sudo mode (default false).

---

__Adding Commands__

Method 1: External Injection (Recommended, no source modification)

```js
window.registerCommand('greet', (args) => {
  const name = args[0] || 'world';
  return `Hi ${name}, welcome to WemLinux!`;
});

// Supports async
window.registerCommand('fetch', async (args) => {
  // Can fetch network data here
  return 'data fetched';
});
```

Method 2: Register within the source

Add near s.register("exit", ...) in wemlinux.js:

```js
s.register("greet", function(e) {
  return "Hi " + (e.join(" ") || "world") + ", welcome to WemLinux!";
});
```

Method 3: Via commandRouter (runtime dynamic registration)

```js
window.commandRouter.register('greet', (args) => 'Hi ' + args.join(' '));
```

---

### Command Writing Standards

Handler Signature

```js
/**
 * @param {string[]} args - Command arguments (excluding the command name itself)
 * @returns {string|Promise<string>} Output text
 */
function handler(args) { ... }
```

Return Value Conventions

Return Value Meaning
string (non-empty) Normal output, displayed directly
"" (empty) Success but no output (e.g., rm)
"sh: xxx: No such file or directory" Error message, lastExitCode set to 1
"__CLEAR__" Clear the terminal
"__BREAK__" / "__CONTINUE__" / "__RETURN__" Control flow signals

Argument Parsing Conventions

· Arguments are split by whitespace (quotes are not processed); quotes must be stripped within the command itself (refer to find -name "*.txt" for quote handling).
· Path arguments should be resolved using window.safeResolvePath or the internal a(path) function.
· Optional flags use -x format; unknown options should return an error:
  ```js
  if (args[0].startsWith('-')) return "greet: invalid option '" + args[0] + "'";
  ```

File System Access

Unified access through the webfs object (internal webfs / global window.webfs are equivalent):

```js
if (!webfs.fileExist(path)) return "cmd: " + path + ": No such file or directory";
if (webfs.isDir(path))      return "cmd: " + path + ": Is a directory";
const content = webfs.read(path) || "";
```

---

### WemLinux Usage Tutorial

Basic Commands

```
pwd                          # Current directory
ls / ls -la /etc             # List directory (-a includes hidden, -l detailed info)
cd /etc && pwd               # Change directory
cat /etc/hostname            # View file
echo "hello world"           # Output text
clear                        # Clear screen
history                      # View command history
whoami / id / uname -a       # User / system information
```

File Operations

```
mkdir -p /home/user/blog     # Create directory recursively
touch /tmp/a.txt             # Create empty file
cp a.txt b.txt               # Copy
mv a.txt renamed.txt         # Move/rename
rm file / rm -rf dir         # Delete
ln -s /etc/hostname /tmp/l   # Symbolic link (cat resolves automatically)
find /home -name "*.txt"     # Search by name (supports * and ? wildcards)
tree /etc                    # Directory tree
du -s /etc                   # Directory usage
stat /etc/hostname           # File details
chmod 755 script.sh          # Change permissions
```

Text Processing

```
sort file.txt                # Sort (-n numeric -r reverse -u unique -f ignore case)
grep keyword file.txt        # Search
head -3 file.txt             # First lines
tail -2 file.txt             # Last lines
wc -l / -w / -c file.txt     # Line/word/byte count
sed 's/a/b/' file.txt        # Replace
awk '{print $1}' file.txt    # Column extraction
uniq file.txt                # Deduplicate
cut -d: -f1 /etc/passwd      # Cut by delimiter
```

Redirection and Pipes

```
echo "hello" > file.txt      # Overwrite
echo "again" >> file.txt     # Append
cat /etc/passwd | grep user  # Pipe
ls / && echo "OK"            # Execute only on success
cat x || echo "Failed"       # Execute only on failure
```

Processes and System

```
ps / top                     # Process list
kill <pid>                   # Kill process
free                         # Memory
df / mount / umount          # Disk/mount
uptime                       # Uptime
date                         # Date/time
sleep 2                      # Delay
```

Networking (simulated)

```
ping baidu.com               # Ping
curl http://example.com      # Request (simulated)
wget http://example.com/a    # Download (simulated)
netstat / ifconfig           # Network status
hostname                     # Hostname
```

Environment Variables

```
echo $HOME                   # View variable
export MY_VAR=hello          # Export
unset MY_VAR                 # Delete
set / env                    # List all
readonly RO=1                # Read-only variable (cannot be modified)
```

Shell Programming

```
# if / else
if test -f /etc/hostname; then echo "Exists"; else echo "Does not exist"; fi

# for loop
for i in 1 2 3; do echo "Iteration $i"; done

# while loop
while test $x -lt 3; do echo $x; x=$((x+1)); done

# Functions
function greet() { echo "Hello $1"; }
greet Evo

# Aliases
alias ll="ls -la"
ll /etc
```

Help System

```
help                # List all commands
help ls             # View usage for a specific command
```

### wemlinux2

wemlinux2 and wemlinux differ significantly, hence two separate version files are released to accommodate different needs:

1: All data stored directly in memory; data is cleared on page refresh
2: Uses IndexedDB to persist the webfs object; data persists but may pose security risks

1: All commands stored in the global object
2: All pre-installed system commands stored in /bin, can be invoked via absolute paths

1: System password: 10086
2: No default password; can be changed via passwd

1: No configuration files
2: ~/.bashrc and ~/.profile configuration files

1: PATH environment variable has no effect
2: PATH environment variable supports loading commands and native functionality

1: Supports command extensions
2: Also supports extensions, but the upcoming WPK extension package manager will only support wemlinux 2

External APIs remain unchanged

---

### Browser Requirements

· Chrome 57+
· Firefox 52+
· Microsoft Edge 15+
· Safari 10.1+
· FF 48

Note: Internet Explorer all versions do NOT support wemlinux!

### License

MIT License
