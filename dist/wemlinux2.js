/* wemlinux 2
   凌寒科技 项目
*/

/**
 * webfs - 虚拟文件系统
 * @namespace webfs
 */
window.webfs = window.webfs || (function() {
  "use strict";

  /**
   * 创建文件系统节点
   * @param {string} type - 节点类型："dir" 或 "file"
   * @param {string} content - 文件内容（目录忽略）
   * @param {string} mode - 权限位字符串，如 "0755"
   * @returns {Object} 节点对象
   */
  function createNode(type, content, mode) {
    return {
      type: type,
      content: content || "",
      mode: mode || (type === "dir" ? "0755" : "0644"),
      owner: "root",
      group: "root",
      mtime: Date.now()
    };
  }

  /** @type {Object} 根节点 */
  var root = createNode("dir", "", "0755");

  /**
   * 规范化路径：解析 . / .. / 重复斜杠，返回绝对路径
   * @param {string} path - 原始路径
   * @returns {string} 规范化绝对路径，如 "/a/b"
   * @example
   * normalizePath("/a/../b//c") // => "/b/c"
   */
  function normalizePath(path) {
    if (!path) return "/";
    var parts = String(path).split("/");
    var stack = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p || p === ".") continue;
      if (p === "..") { stack.pop(); continue; }
      stack.push(p);
    }
    return "/" + stack.join("/");
  }

  /**
   * 获取指定路径的节点，父目录不存在时返回 null
   * @param {string} path - 目标路径
   * @returns {Object|null} 节点对象或 null
   */
  function getNode(path) {
    if (path === "/") return root;
    var parts = normalizePath(path).split("/").filter(Boolean);
    var cur = root;
    for (var i = 0; i < parts.length; i++) {
      if (!cur || cur.type !== "dir" || !cur.children) return null;
      cur = cur.children[parts[i]];
    }
    return cur || null;
  }

  /**
   * 获取父节点，用于写入前自动建目录
   * @param {string} path - 目标路径
   * @returns {Object} 父节点（不存在则自动创建）
   */
  function ensureParent(path) {
    var parts = normalizePath(path).split("/").filter(Boolean);
    var cur = root;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur.children) cur.children = {};
      if (!cur.children[parts[i]]) {
        var d = createNode("dir", "", "0755");
        d.children = {};
        cur.children[parts[i]] = d;
      }
      cur = cur.children[parts[i]];
    }
    if (!cur.children) cur.children = {};
    return cur;
  }

  /**
   * 判断路径是否存在
   * @param {string} path - 目标路径
   * @returns {boolean} 是否存在
   * @example
   * webfs.exists("/etc/hostname") // => true
   */
  function exists(path) {
    return getNode(path) !== null;
  }

  /**
   * 判断路径是否为目录
   * @param {string} path - 目标路径
   * @returns {boolean} 是否为目录
   */
  function isDir(path) {
    var n = getNode(path);
    return !!n && n.type === "dir";
  }

  /**
   * 判断文件是否存在
   * @param {string} path - 目标路径
   * @returns {boolean} 文件或目录是否存在
   */
  function fileExist(path) {
    return exists(path);
  }

  /**
   * 列出目录内容
   * @param {string} path - 目录路径
   * @returns {Array<{name: string, type: string}>} 条目列表
   * @example
   * webfs.getFileList("/etc") // => [{name:"hostname", type:"file"}, ...]
   */
  function getFileList(path) {
    var n = getNode(path);
    if (!n || n.type !== "dir" || !n.children) return [];
    return Object.keys(n.children).map(function(k) {
      return { name: k, type: n.children[k].type === "dir" ? "directory" : "file" };
    });
  }

  /**
   * 读取文件内容（兼容 wc.js）
   * @param {string} path - 文件路径
   * @returns {string|null} 文件内容，不存在返回 null
   */
  function read(path, depth) {
    var n = getNode(path);
    if (!n || n.type !== "file") return null;
    var content = n.content;
    // 软链接解析：内容以 "LINK:" 开头时递归读取目标（深度限制防环）
    if (typeof content === "string" && content.indexOf("LINK:") === 0 && (depth || 0) < 10) {
      var target = content.slice(5);
      return read(target, (depth || 0) + 1);
    }
    return content;
  }

  /**
   * 写入文件
   * @param {string} path - 文件路径
   * @param {string} content - 文件内容
   * @returns {boolean} 是否写入成功
   * @example
   * webfs.write("/home/user/note.txt", "hello");
   */
  function write(path, content) {
    var norm = normalizePath(path);
    if (norm === "/") return false;
    var parent = ensureParent(norm);
    var name = norm.split("/").filter(Boolean).pop();
    var existing = parent.children[name];
    if (existing && existing.type === "dir") return false;
    parent.children[name] = createNode("file", String(content == null ? "" : content), existing ? existing.mode : "0644");
    scheduleSave();
    return true;
  }

  /**
   * 删除文件或目录
   * @param {string} path - 目标路径
   * @returns {boolean} 是否删除成功
   */
  function delFile(path) {
    var norm = normalizePath(path);
    if (norm === "/") return false;
    var parts = norm.split("/").filter(Boolean);
    var name = parts.pop();
    var parent = getNode("/" + parts.join("/"));
    if (!parent || !parent.children || !parent.children[name]) return false;
    delete parent.children[name];
    scheduleSave();
    return true;
  }

  /**
   * 获取文件大小（字节）
   * @param {string} path - 文件路径
   * @returns {number} 文件大小，不存在返回 0
   */
  function getFileSize(path) {
    var n = getNode(path);
    if (!n) return 0;
    if (n.type === "dir") return 0;
    return (n.content || "").length;
  }

  /**
   * 创建目录（自动创建缺失的父目录）
   * @param {string} path - 目录路径
   * @returns {boolean} 是否创建成功
   */
  function mkdir(path) {
    var norm = normalizePath(path);
    if (norm === "/") return false;
    var parent = ensureParent(norm);
    var name = norm.split("/").filter(Boolean).pop();
    if (parent.children[name]) return false;
    var d = createNode("dir", "", "0755");
    d.children = {};
    parent.children[name] = d;
    scheduleSave();
    return true;
  }

  /**
   * 重命名/移动文件或目录
   * @param {string} oldPath - 原路径
   * @param {string} newPath - 新路径
   * @returns {boolean} 是否成功
   */
  function rename(oldPath, newPath) {
    var normOld = normalizePath(oldPath);
    var normNew = normalizePath(newPath);
    if (normOld === "/" || normNew === "/") return false;
    var parts = normOld.split("/").filter(Boolean);
    var name = parts.pop();
    var parent = getNode("/" + parts.join("/"));
    if (!parent || !parent.children || !parent.children[name]) return false;
    var target = ensureParent(normNew);
    var newName = normNew.split("/").filter(Boolean).pop();
    target.children[newName] = parent.children[name];
    delete parent.children[name];
    scheduleSave();
    return true;
  }

  /**
   * IndexedDB 持久化
   * 浏览器环境自动使用，Node 测试环境静默跳过
   */
  var _saveTimer = null;
  function scheduleSave() {
    if (typeof indexedDB === "undefined") return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(save, 150);
  }
  function save() {
    if (typeof indexedDB === "undefined") return Promise.resolve(false);
    return new Promise(function(res, rej) {
      try {
        var req = indexedDB.open("wemlinux", 1);
        req.onupgradeneeded = function() {
          var db = req.result;
          if (!db.objectStoreNames.contains("fs")) db.createObjectStore("fs");
        };
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction("fs", "readwrite");
          tx.objectStore("fs").put(JSON.stringify(root), "root");
          tx.oncomplete = function() { db.close(); res(true); };
          tx.onerror = function() { db.close(); rej(tx.error); };
        };
        req.onerror = function() { rej(req.error); };
      } catch (e) { res(false); }
    });
  }
  function load() {
    if (typeof indexedDB === "undefined") return Promise.resolve(false);
    return new Promise(function(res, rej) {
      try {
        var req = indexedDB.open("wemlinux", 1);
        req.onupgradeneeded = function() {
          var db = req.result;
          if (!db.objectStoreNames.contains("fs")) db.createObjectStore("fs");
        };
        req.onsuccess = function() {
          var db = req.result;
          var tx = db.transaction("fs", "readonly");
          var get = tx.objectStore("fs").get("root");
          get.onsuccess = function() {
            if (get.result) {
              try { root = JSON.parse(get.result); db.close(); res(true); }
              catch (e) { db.close(); res(false); }
            } else { db.close(); res(false); }
          };
          get.onerror = function() { db.close(); res(false); };
        };
        req.onerror = function() { res(false); };
      } catch (e) { res(false); }
    });
  }

  /**
   * 获取文件状态信息
   * @param {string} path - 目标路径
   * @returns {Object|null} {mode, owner, group, size, mtime} 或 null
   */
  function stat(path) {
    var n = getNode(path);
    if (!n) return null;
    return {
      mode: n.mode,
      owner: n.owner,
      group: n.group,
      size: n.type === "dir" ? 0 : (n.content || "").length,
      mtime: n.mtime,
      type: n.type
    };
  }

  /**
   * 创建软链接（内容以 "LINK:" 前缀存目标路径，read 时自动解析）
   * @param {string} target - 链接目标路径
   * @param {string} linkPath - 链接存放路径
   * @returns {boolean} 是否成功
   */
  function symlink(target, linkPath) {
    var norm = normalizePath(linkPath);
    if (norm === "/") return false;
    var parent = norm.substring(0, norm.lastIndexOf("/")) || "/";
    if (!isDir(parent)) return false;
    var name = norm.split("/").filter(Boolean).pop();
    if (!name) return false;
    var pn = getNode(parent);
    pn.children[name] = createNode("file", "LINK:" + target, "0777");
    return true;
  }

  /**
   * 读取软链接目标（非软链接返回空串）
   * @param {string} path - 链接路径
   * @returns {string} 目标路径或 ""
   */
  function readlink(path) {
    var n = getNode(path);
    if (!n || n.type !== "file") return "";
    var c = n.content;
    return (typeof c === "string" && c.indexOf("LINK:") === 0) ? c.slice(5) : "";
  }

  /**
   * 判断路径是否为软链接
   * @param {string} path - 目标路径
   * @returns {boolean} 是否为软链接
   */
  function isLink(path) {
    var n = getNode(path);
    return !!n && n.type === "file" && typeof n.content === "string" && n.content.indexOf("LINK:") === 0;
  }

  /**
   * 修改文件权限
   * @param {string} path - 目标路径
   * @param {string} mode - 权限位，如 "0755"
   * @returns {boolean} 是否成功
   */
  function chmod(path, mode) {
    var n = getNode(path);
    if (!n) return false;
    n.mode = String(mode).padStart(3, "0");
    return true;
  }

  /**
   * 退出回调（原 wc.js 的 exit；浏览器中默认无操作，可外部覆盖）
   * @returns {void}
   */
  function exit() {}

  /**
   * 初始化标准目录树（类 Linux 结构 + 示例文件）
   * @returns {void}
   */
  function initDefaultTree() {
    var dirs = ["bin","dev","etc","home","lib","proc","sbin","sys","tmp","usr","var",
                "system","system/bin","system/xbin","sbin","vendor","vendor/bin",
                "home/user","home/root","etc/init.d","usr/bin","usr/local/bin","var/log"];
    for (var i = 0; i < dirs.length; i++) mkdir(dirs[i]);
    write("/etc/hostname", "humminglinux\n");
    write("/etc/motd", "Welcome to WemLinux - a lightweight Linux simulator.\n");
    write("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\nuser:x:1000:1000:user:/home/user:/bin/bash\n");
    write("/etc/hostname", "humminglinux\n");
    write("/home/user/README.txt", "Welcome to WemLinux!\nType 'help' to see available commands.\n");
    write("/home/.bashrc", "# ~/.bashrc - executed by interactive shells\nalias ll='ls -la'\nalias la='ls -a'\nexport EDITOR=vi\n");
    write("/home/.profile", "# ~/.profile - executed at login\nexport PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nexport TZ=Asia/Shanghai\nexport SHELL=/bin/bash\n");
    write("/tmp/.keep", "");
  }

  initDefaultTree();

  return {
    exists: exists,
    fileExist: fileExist,
    isDir: isDir,
    save: save,
    load: load,
    getFileList: getFileList,
    read: read,
    write: write,
    delFile: delFile,
    getFileSize: getFileSize,
    mkdir: mkdir,
    rename: rename,
    stat: stat,
    chmod: chmod,
    exit: exit,
    normalizePath: normalizePath,
    symlink: symlink,
    readlink: readlink,
    isLink: isLink
  };
})();

/**
 * 获取文件权限字符串（供 ls -l 等使用）
 * @param {string} path - 文件路径
 * @returns {string} 权限字符串，如 "-rw-r--r--" 或 "drwxr-xr-x"
 * @example
 * window.getFileModeString("/etc/hostname") // => "-rw-r--r--"
 */
window.getFileModeString = window.getFileModeString || function(path) {
  var st = window.webfs && window.webfs.stat ? window.webfs.stat(path) : null;
  if (!st) return "-rw-r--r--";
  var mode = st.mode || "0644";
  if (mode.length === 4) mode = mode.slice(1);
  var perm = "";
  for (var i = 0; i < 3; i++) {
    var n = parseInt(mode[i], 10) || 0;
    perm += (n & 4 ? "r" : "-") + (n & 2 ? "w" : "-") + (n & 1 ? "x" : "-");
  }
  return (st.type === "dir" ? "d" : "-") + perm;
};


/**
 * wemlinux v2.4
 * @author: evo
 * @date: 2026-08-26
 * @license: MIT License
 */

/**
 * Execute a shell command
 * @param {string} command - Command string to execute
 * @returns {Promise<string>} Command execution result
 * @example
 * const output = await window.executeShellCommand("ls -la");
 */

/**
 * Handle and execute command (alias of executeShellCommand)
 * @param {string} command - Command string to execute
 * @returns {Promise<string>} Command execution result
 * @example
 * const result = await window.handleCommand("echo Hello World");
 */

/**
 * Global state object - contains all shell state information
 * @type {Object}
 * @property {string} cwd - Current working directory
 * @property {string} pid - Process ID
 * @property {Object} env - Environment variables
 * @property {Object} vars - User-defined variables
 * @property {string[]} readonly - Readonly variable list
 * @property {string[]} exported - Exported environment variables
 * @property {Object} aliases - Command aliases
 * @property {string[]} history - Command history
 * @property {Object} permissions - File permissions
 * @property {Object} ulimit - Process limits
 * @property {Object} functions - Shell function definitions
 * @property {string} oldpwd - Previous working directory
 * @property {number} lastExitCode - Last command exit code
 * @property {string} lastOutput - Last output
 * @property {string[]} dirStack - Directory stack (pushd/popd)
 * @example
 * console.log(window._state.cwd);
 * console.log(window._state.env.USER);
 * window._state.vars.myvar = "value";
 */

/**
 * Command router - contains all registered command handlers
 * @type {Object}
 * @property {Object} handlers - Command handler function map
 * @property {string[]} registered - Registered command list
 * @property {Function} getHandler - Get command handler
 * @property {Function} has - Check if command exists
 * @property {Function} execute - Execute command
 * @example
 * if (window.commandRouter.has("ls")) {
 *   console.log("ls command available");
 * }
 * const result = await window.commandRouter.execute("echo", ["Hello"]);
 */

/**
 * Resolve path - supports ~, -, ., .. path syntax
 * @param {string} path - Path to resolve
 * @returns {string} Resolved absolute path
 * @example
 * const path = window.safeResolvePath("~/documents/file.txt");
 * const oldPath = window.safeResolvePath("-");
 */

window.executeShellCommand=window.executeShellCommand||function(e) {
  return window.handleCommand(e)
},window.handleCommand=window.handleCommand||async function(e) {
  
},window._state=window._state|| {
  
},window.commandRouter=window.commandRouter||null,window.registerCommand=window.registerCommand||null,window.safeResolvePath=window.safeResolvePath||function(e) {
  
},function() {
  (void 0===window._state||"undefined"==typeof window._state.cwd)&&(window._state= {
    cwd:"/",pid:String(Math.floor(9e4*Math.random())+1e4),env: {
      PATH:"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/bin/bash",USER:"root",HOSTNAME:"humminglinux",TERM:"xterm-256color",TZ:"Asia/Shanghai",ENV:"~/.bashrc",PWD:"/",OLDPWD:"",SHLVL:"1",LANG:"en_US.UTF-8",LOGNAME:"root"
    },vars: {
      
    },readonly:[],exported:[],aliases: {
      
    },history:[],permissions: {
      
    },ulimit: {
      soft:256,hard:512,processes:[]
    },jobs:[],backgroundJobs:[],lastOutput:"",lastExitCode:0,oldpwd:"/",dirStack:[],functions: {
      
    },loopDepth:0,breakLevel:0,continueLevel:0
  }),void 0!==window._state&&window._state?window._state.env||(window._state.env= {
    PATH:"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/bin/bash",USER:"root",HOSTNAME:"humminglinux",TERM:"xterm-256color",TZ:"Asia/Shanghai",ENV:"~/.bashrc",PWD:"/",OLDPWD:"",SHLVL:"1",LANG:"en_US.UTF-8",LOGNAME:"root"
  }):window._state= {
    cwd:"/",pid:String(Math.floor(9e4*Math.random())+1e4),env: {
      PATH:"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/bin/bash",USER:"root",HOSTNAME:"humminglinux",TERM:"xterm-256color",TZ:"Asia/Shanghai",ENV:"~/.bashrc",PWD:"/",OLDPWD:"",SHLVL:"1",LANG:"en_US.UTF-8",LOGNAME:"root"
    },vars: {
      
    },readonly:[],exported:[],aliases: {
      
    },history:[],permissions: {
      
    },ulimit: {
      soft:256,hard:512,processes:[]
    },jobs:[],backgroundJobs:[],lastOutput:"",lastExitCode:0,oldpwd:"/",dirStack:[],functions: {
      
    },loopDepth:0,breakLevel:0,continueLevel:0
  },window._state&&!window._state.readonly&&(window._state.readonly=[]),window._state&&!window._state.exported&&(window._state.exported=[]),window._state&&!window._state.aliases&&(window._state.aliases= {
    
  }),window._state&&!window._state.vars&&(window._state.vars= {
    
  }),function() {
    const st=window._state;
    st.exported||(st.exported=[]);
    for(const k in st.env)st.exported.includes(k)||st.exported.push(k)
  }(),window._state&&!window._state.permissions&&(window._state.permissions= {
    
  }),window._state&&!window._state.dirStack&&(window._state.dirStack=[]),window._state&&!window._state.functions&&(window._state.functions= {
    
  }),window._state&&!window._state.history&&(window._state.history=[]),window._state&&!window._state.ulimit&&(window._state.ulimit= {
    soft:256,hard:512,processes:[]
  }),window._state&&!window._state.jobs&&(window._state.jobs=[]),window._state&&!window._state.backgroundJobs&&(window._state.backgroundJobs=[]);
  const e=window._state,t=document.getElementById("output"),n=document.getElementById("input");
  let r=[],i=-1,s=null,o=!1;
  class c {
    constructor() {
      this.handlers= {
        
      },this.registered=[]
    }register(e,t) {
      "function"==typeof t&&(this.handlers[e]=t,this.registered.push(e))
    }getHandler(e) {
      return this.handlers[e]||null
    }has(e) {
      return e in this.handlers
    }execute(t,n) {
      const r=this.getHandler(t);
      if(r)try {
        const e=r(n);
        return e&&"function"==typeof e.then?e:Promise.resolve(e||"")
      }catch(e) {
        return Promise.resolve("sh: "+t+": error: "+e.message)
      }if(e.functions&&e.functions[t]) {
        const r=e.functions[t];
        for(let t=0;
        t<n.length;
        t++)e.vars["$"+(t+1)]=n[t];
        return x(r)
      }return Promise.resolve("sh: "+t+": command not found")
    }
  }function a(t) {
    try {
      if("function"==typeof window.resolvePath)return window.resolvePath(t);
      if(!t)return e.env.HOME||"/home";
      if("~"===t)return e.env.HOME||"/home";
      if(t.indexOf("~/")===0)return(e.env.HOME||"/home")+t.slice(1);
      if("/"===t)return"/";
      if("-"===t&&e.oldpwd)return e.oldpwd;
      if(t.startsWith("/")) {
        const e=t.split("/").filter(e=>e&&"."!==e),n=[];
        for(const t of e)".."===t?n.pop():n.push(t);
        return"/"+n.join("/")
      }const n=(e.cwd+"/"+t).split("/").filter(e=>e&&"."!==e),r=[];
      for(const e of n)".."===e?r.pop():r.push(e);
      return"/"+r.join("/")
    }catch(e) {
      return t
    }
  }function l(e) {
    try {
      return"function"==typeof window.getFileModeString?window.getFileModeString(e):l(e)
    }catch(e) {
      
    }return"-rw-r--r--"
  }function u(e) {
    if(0===e)return"0B";
    const t=Math.floor(Math.log(e)/Math.log(1024));
    return parseFloat((e/Math.pow(1024,t)).toFixed(2))+["B","KB","MB","GB"][t]
  }function f(e) {
    return e+": missing operand\nTry '"+e+" --help' for more information."
  }function d(e,t) {
    return e+": cannot access '"+t+"': No such file or directory"
  }function h(e,t) {
    return e+": cannot remove '"+t+"': Is a directory"
  }function p(e,t) {
    return e+": invalid option '"+t+"'\nTry '"+e+" --help' for more information."
  }function m(e) {
    return/^\d+$/.test(e)
  }function g(t) {
    return e.readonly&&e.readonly.includes(t)
  }function w(e) {
    var t=webfs.getFileList(e)||[];
    Array.isArray(t)||(t=[]);
    for(var n=0;
    n<t.length;
    n++) {
      var r=t[n],i=e+"/"+r.name;
      if("directory"===r.type)w(i);
      else try {
        webfs.delFile(i)
      }catch(e) {
        
      }
    }try {
      webfs.delFile(e)
    }catch(e) {
      
    }
  }function v(t) {
    const _sq=[];
    t=t.replace(/'[^']*'/g,function(m){_sq.push(m);return"\u0003"+(_sq.length-1)+"\u0003"});
    let n=t;
    if(t.includes("$?")) {
      const t=void 0!==e.lastExitCode?e.lastExitCode:0;
      n=n.replace(/\$\?/g,String(t))
    }t.includes("$RANDOM")&&(n=n.replace(/\$RANDOM/g,String(Math.floor(32768*Math.random())))),t.includes("$BASH_VERSION")&&(n=n.replace(/\$BASH_VERSION/g,"5.2.37(1)-release")),t.includes("$BASH_PID")&&(n=n.replace(/\$BASH_PID/g,e.pid)),t.includes("$BASH_SOURCE")&&(n=n.replace(/\$BASH_SOURCE/g,"wemlinux.js")),t.includes("$BASH_LINENO")&&(n=n.replace(/\$BASH_LINENO/g,"0")),t.includes("$BASH_SUBSHELL")&&(n=n.replace(/\$BASH_SUBSHELL/g,"0"));
    const r=t.match(/\$\{([^}]*)\}/g);
    if(r)for(const t of r) {
      const r=t.slice(2,-1),i=e.vars[r]||e.env[r]||"";
      n=n.replace(t,i)
    }const i=t.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if(i)for(const t of i) {
      const r=t.slice(1);
      if("?"!==r) {
        const i=e.vars[r]||e.env[r]||"";
        n=n.replace(t,i)
      }
    }const d=t.match(/\$\d+/g);if(d)for(const t of d){const i=e.vars[t]||e.env[t]||"";n=n.replace(t,i)}
    t.includes("$((")&&(n=n.replace(/\$\(\(([^)]*)\)\)/g,function(m,x){
      let s=x;
      s=s.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g,function(mm,vv){return e.vars[vv]||e.env[vv]||mm});
      s=s.replace(/(^|[^a-zA-Z0-9_])([a-zA-Z_][a-zA-Z0-9_]*)/g,function(mm,p,vv){return p+(void 0!==e.vars[vv]?e.vars[vv]:(void 0!==e.env[vv]?e.env[vv]:mm))});
      try {
        const r=Function('"use strict"; return ('+s+")")();
        return void 0!==r?String(r):m
      }catch(q) {
        return m
      }
    }))
    return n.replace(/\u0003(\d+)\u0003/g,function(m,d){return _sq[+d]})
  }async function expandC(t,dv){
    t=String(t==null?"":t);
    if(dv!==false)t=v(t);
    const _sq=[];
    t=t.replace(/'[^']*'/g,function(m){_sq.push(m);return"\u0003"+(_sq.length-1)+"\u0003"});
    let guard=0;
    while(/\$\((?!\()[^)]*\)/.test(t)&&guard++<20){
      const m=t.match(/\$\((?!\()[^)]*\)/);
      if(!m)break;
      const cmd=m[0].slice(2,-1);
      const out=await b(cmd.trim());
      t=t.replace(m[0],(out==null?"":out).trim());
    }
    return t.replace(/\u0003(\d+)\u0003/g,function(m,d){return _sq[+d]});
  }function inBlock(s){
    s=String(s||"").trim();
    const m=s.match(/^(if|while|for|case)\b/);
    if(!m)return false;
    const k=m[1],close={if:"fi",while:"done",for:"done",case:"esac"}[k];
    const opens=(s.match(new RegExp("\\b"+k+"\\b","g"))||[]).length;
    const closes=(s.match(new RegExp("(^|[;])\\s*"+close+"\\b","gm"))||[]).length;
    return opens>closes;
  }function smartSplit(s){
    const out=[],parts=String(s||"").split(";");let buf="";
    for(let i=0;i<parts.length;i++){
      buf=(buf?buf+";":"")+parts[i];
      if(!inBlock(buf)){out.push(buf.trim());buf="";}
    }
    if(buf.trim())out.push(buf.trim());
    return out;
  }function _singleTest(t){
    t=String(t==null?"":t);
    if(t.startsWith("-e ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"}
    if(t.startsWith("-f ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)&&!webfs.isDir(e)?"":"1"}
    if(t.startsWith("-d ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.isDir&&webfs.isDir(e)?"":"1"}
    if(t.startsWith("-r ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"}
    if(t.startsWith("-w ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"}
    if(t.startsWith("-x ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"}
    if(t.startsWith("-s ")){const e=webfs.normalizePath(t.slice(3).trim());return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)&&(webfs.getFileSize(e)||0)>0?"":"1"}
    if(t.startsWith("-z ")){const e=t.slice(3).trim();return""===e||'""'===e||"''"===e?"":"1"}
    if(t.startsWith("-n ")){const e=t.slice(3).trim();return""!==e&&'""'!==e&&"''"!==e?"":"1"}
    const r=t.match(/^(.+?)\s*!=\s*(.+)$/);
    if(r){var R1=r[1].trim().replace(/^["']|["']$/g,""),R2=r[2].trim().replace(/^["']|["']$/g,"");return R1!==R2?"":"1";}
    const n=t.match(/^(.+?)\s*(==|=)\s*(.+)$/);
    if(n){var A1=n[1].trim().replace(/^["']|["']$/g,""),A2=n[3].trim().replace(/^["']|["']$/g,"");return A1===A2?"":"1";}
    const i=t.match(/^(.+?)\s*-eq\s*(.+)$/);
    if(i)return(parseInt(i[1].trim())||0)===(parseInt(i[2].trim())||0)?"":"1";
    const s=t.match(/^(.+?)\s*-ne\s*(.+)$/);
    if(s)return(parseInt(s[1].trim())||0)!==(parseInt(s[2].trim())||0)?"":"1";
    const o=t.match(/^(.+?)\s*-gt\s*(.+)$/);
    if(o)return(parseInt(o[1].trim())||0)>(parseInt(o[2].trim())||0)?"":"1";
    const c=t.match(/^(.+?)\s*-ge\s*(.+)$/);
    if(c)return(parseInt(c[1].trim())||0)>=(parseInt(c[2].trim())||0)?"":"1";
    const a=t.match(/^(.+?)\s*-lt\s*(.+)$/);
    if(a)return(parseInt(a[1].trim())||0)<(parseInt(a[2].trim())||0)?"":"1";
    const l=t.match(/^(.+?)\s*-le\s*(.+)$/);
    return l?(parseInt(l[1].trim())||0)<=(parseInt(l[2].trim())||0)?"":"1":"0"
  }function _evalTestExpr(expr){
    expr=String(expr==null?"":expr).trim();
    const neg=expr.match(/^!\s+(.+)$/);
    if(neg)return _evalTestExpr(neg[1].trim())==""?"1":"";
    const and=expr.split(/\s+-a\s+/);
    if(and.length>1)return and.every(function(x){return _evalTestExpr(x.trim())==""})?"":"1";
    const or=expr.split(/\s+-o\s+/);
    if(or.length>1)return or.some(function(x){return _evalTestExpr(x.trim())==""})?"":"1";
    return _singleTest(expr);
  }function y(e) {
    if(!e||""===e.trim())return"";
    let t="";
    return(async()=> {
      const n=await function(e) {
        return e&&""!==e.trim()?b(e.trim()):Promise.resolve("")
      }(e.trim());
      t=n
    })(),t
  }async function x(t) {
    if(!t)return"";
    const n=t.split("\n");
    let r=[],i=!1,o="",c=[],a=!1,l=[],u="",f="",d=!1,h="",p=[],m=[],w=!1;
    for(const t of n) {
      const n=t.trim();
      if(!n||n.startsWith("#"))continue;
      if(n.match(/^[^\s{}();&|]+\s*\(\)\s*\{/)) {
        const m2=n.match(/^([^\s{}();&|]+)\s*\(\)\s*\{/);
        if(m2) {
          const braceIdx=n.indexOf("}",m2[0].length);
          if(braceIdx>-1) {
            e.functions||(e.functions={});
            e.functions[m2[1]]=n.slice(m2[0].length,braceIdx).trim();
            continue
          }
          o=m2[1],i=!0,c=[];
          const t=n.slice(m2[0].length).trim();
          t&&"{"!==t&&c.push(t)
        }continue
      }if(i) {
        if("}"===n) {
          i=!1,e.functions||(e.functions= {
            
          }),e.functions[o]=c.join("\n");
          continue
        }c.push(t);
        continue
      }if("if"===n||n.startsWith("if ")) {
        const m1=n.match(/^if\s+(.+?);\s*then\s*([\s\S]*)$/);
        if(m1&&/\bfi\b/.test(m1[2])) {
          const rest2=m1[2].replace(/;\s*fi\s*$/,"");
          const ei=rest2.indexOf("; else ");
          const body1=ei>-1?rest2.slice(0,ei):rest2;
          const body2=ei>-1?rest2.slice(ei+7):"";
          const ca=(await expandC(m1[1])).split(/\s+/);
          const t=await s.execute(ca[0],ca.slice(1));
          const chosen=(""===t||null==t||"0"===t)?body1:body2;
          if(chosen.trim()) {
            const o2=await x(chosen);
            if(o2&&""!==o2)r.push(o2)
          }continue
        }d=!0,h=n.slice(2).trim().replace(/;\s*then\s*$/,""),p=[],m=[],w=!1;
        continue
      }if(d) {
        if("then"===n)continue;
        if("else"===n) {
          w=!0;
          continue
        }if("fi"===n) {
          d=!1;
          const e=(await expandC(h)).split(/\s+/);
          if(e.length>0) {
            const t=await s.execute(e[0],e.slice(1));
            let n=""===t||null==t||"0"===t?p.join("\n"):m.join("\n");
            if(n) {
              const e=await x(n);
              e&&r.push(e)
            }
          }continue
        }w?m.push(t):p.push(t);
        continue
      }if("while"===n||n.startsWith("while ")) {
        const m1=n.match(/^while\s+(.+?);\s*do\s*([\s\S]*?);\s*done\s*$/);
        if(m1) {
          let cnt=0;
          while(cnt<100) {
            const ca=(await expandC(m1[1])).split(/\s+/);
            const t=await s.execute(ca[0],ca.slice(1));
            if(""!==t&&null!=t&&"0"!==t)break;
            const o2=await x(m1[2]);
            if(o2&&""!==o2)r.push(o2);
            cnt++
          }continue
        }a=!0,f="while",u=n.slice(5).trim(),l=[];
        continue
      }if("for"===n||n.startsWith("for ")) {
        const m1=n.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+?);\s*do\s*([\s\S]*?);\s*done\s*$/);
        if(m1) {
          const items=m1[2].trim().split(/\s+/);
          for(const it of items) {
            e.vars[m1[1]]=it;
            const o2=await x(m1[3]);
            if(o2&&""!==o2)r.push(o2)
          }continue
        }a=!0,f="for",u=n.slice(3).trim(),l=[];
        continue
      }if(a) {
        if("do"===n)continue;
        if("done"===n) {
          if(a=!1,"while"===f) {
            let e=0;
            const t=100;
            for(;
            e<t;
            ) {
              const t=v(u).split(/\s+/);
              if(0===t.length)break;
              const n=await s.execute(t[0],t.slice(1));
              if(""!==n&&null!=n&&"0"!==n)break;
              const i=await x(l.join("\n"));
              i&&r.push(i),e++
            }
          }else if("for"===f) {
            const t=u.indexOf("in"),n=u.indexOf("do");
            if(t>-1&&n>-1) {
              const i=u.slice(0,t).trim(),s=u.slice(t+2,n).trim().split(/\s+/);
              for(const t of s) {
                e.vars[i]=t;
                const n=await x(l.join("\n"));
                n&&r.push(n)
              }
            }
          }continue
        }l.push(t);
        continue
      }if(n.match(/^[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*/)) {
        const t=n.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*)/);
        if(t) {
          const n=t[1];
          let r=t[2];
          r=v(r),g(n)||(e.vars[n]=r)
        }continue
      }if(n.startsWith("$(")&&n.endsWith(")")) {
        await b(n.slice(2,-1));
        continue
      }const y=await b(n);
      if(y&&""!==y&&r.push(y),"__BREAK__"===y)break;
      if("__RETURN__"===y)break
    }return r.join("\n")
  }
  function pi(cmd, stdin) {
    if(!stdin)return cmd;
    try {
      if("undefined"!=typeof webfs&&webfs.write)webfs.write("/tmp/.pipe",stdin)
    }catch(e) {}
    const parts=cmd.trim().split(/\s+/);
    const n=parts[0];
    const args=[];
    for(let i=1;i<parts.length;i++) {
      if(">"===parts[i]||">>"===parts[i]) {
        i++;
        continue
      }
      args.push(parts[i])
    }
    if(("cat"===n||"sort"===n||"wc"===n||"head"===n||"tail"===n||"uniq"===n)&&args.every(function(p) {
      return p.startsWith("-")
    }))return cmd+" /tmp/.pipe";
    if("grep"===n&&parts.length>1) {
      const nonOpt=args.filter(function(p) {
        return!p.startsWith("-")
      });
      if(1===nonOpt.length)return cmd+" /tmp/.pipe"
    }
    return cmd
  }
  function b(n) {
    const fnM=n.match(/^(?:function\s+)?([^\s{}();&|]+)\s*\(\)\s*\{([\s\S]*?)\}\s*(.*)$/);
    if(fnM) {
      e.functions||(e.functions={});
      e.functions[fnM[1]]=fnM[2].trim();
      const rest=fnM[3].trim();
      if(rest)return b(rest.charAt(0)===";"?rest.slice(1).trim():rest);
      return Promise.resolve("")
    }
    const i=function(t) {
      let n=t;
      const r=n.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if(r&&e.aliases&&e.aliases[r[1]]) {
        const t=n.slice(r[1].length).trim();
        n=e.aliases[r[1]]+(t?" "+t:"")
      }return n
    }(n);
    if(!i)return Promise.resolve("");
    const q=function(s) {
      const a=[];
      const t=s.replace(/"[^"]*"|'[^']*'|\$\([^)]*\)/g,function(m) {
        return a.push(m)-1+"\u0001"
      });
      return {
        text:t,restore:function(s) {
          return s.replace(/(\d+)\u0001/g,function(m,d) {
            return a[+d]
          })
        }
      }
    }(i);
    const _amp=q.text.split(/(?<![&])\s*&\s*(?![&])/);
    if(_amp.length>1){
      const _fgS=q.restore(_amp.pop()).trim();
      const _parts=[];
      for(let _ai=0;_ai<_amp.length;_ai++){const _pc=q.restore(_amp[_ai]).trim();if(_pc)_parts.push(_pc)}
      const _bgo=[];
      for(const _pc of _parts){const _r=bgStart(_pc);_bgo.push(_r.ok?"["+_r.job.num+"] "+_r.pid:_pc+": "+_r.error)}
      const _pre=_bgo.join("\n");
      return b(_fgS).then(function(_o){return _pre?(_pre+"\n"+_o):_o});
    }
    const o=function(e) {
      const kw=e.match(/^\s*(if|while|for|case)\s+/);
      if(kw) {
        const k=kw[1];
        const ok=(k==="if"&&e.indexOf("then")>-1&&e.indexOf("fi")>-1&&/(^|;)\s*fi\s*;?\s*$/.test(e))||
                 (k==="while"&&e.indexOf("do")>-1&&e.indexOf("done")>-1&&/(^|;)\s*done\s*;?\s*$/.test(e))||
                 (k==="for"&&e.indexOf("in")>-1&&e.indexOf("do")>-1&&e.indexOf("done")>-1&&/(^|;)\s*done\s*;?\s*$/.test(e))||
                 (k==="case"&&e.indexOf("esac")>-1&&/(^|;)\s*esac\s*;?\s*$/.test(e))||
                 (k==="function"&&e.indexOf("{")>-1&&e.indexOf("}")>-1&&/(^|;)\s*}\s*;?\s*$/.test(e));
        if(ok)return {
          type:"simple",cmd:e.trim()
        };
      }
      const t=e.split(/\|\|/).map(e=>e.trim());
      if(t.length>1)return {
        type:"or",parts:t
      };
      const n=e.split(/&&/).map(e=>e.trim());
      if(n.length>1)return {
        type:"and",parts:n
      };
      const blk=e.match(/^(.*?);\s*(while\s+[\s\S]*?\bdone|for\s+[\s\S]*?\bdone|if\s+[\s\S]*?\bfi|case\s+[\s\S]*?\besac)\s*;?\s*$/);
      if(blk) {
        const pre=blk[1].split(";").map(x=>x.trim()).filter(x=>x);
        return {
          type:"seq",parts:pre.concat([blk[2].trim()])
        };
      }
      const r=smartSplit(e);
      if(r.length>1)return {
        type:"seq",parts:r
      };
      const p=e.split(/\|/).map(e=>e.trim());
      return p.length>1? {
        type:"pipe",parts:p
      }: {
        type:"simple",cmd:e.trim()
      }
    }(q.text);
    if("or"===o.type) {
      let out="",t=!1,n=Promise.resolve();
      for(const r of o.parts)n=n.then(()=>{
        if(t)return out;
        return b(q.restore(r)).then(n=>{
          if(0===e.lastExitCode){t=!0;if(""!==n&&null!=n)out=n}
          return out
        })
      });
      return n
    }if("and"===o.type) {
      let out=[],t=Promise.resolve(),stop=!1;
      for(const n of o.parts)t=t.then(function() {
        if(stop)return"";
        return b(q.restore(n)).then(function(t) {
          if(0!==e.lastExitCode){stop=!0;return""}
          return""!==t&&null!=t&&out.push(t),""
        }).catch(function(x) {
          stop=!0;
          return out.push("sh: "+x.message),""
        })
      });
      return t.then(function() {
        return out.join("\n")
      })
    }if("seq"===o.type) {
      let e=[],t=Promise.resolve();
      for(const n of o.parts)t=t.then(()=>b(q.restore(n)).then(t=>(""!==t&&null!=t&&e.push(t),"")));
      return t.then(function() {
        return e.join("\n")
      })
    }if("pipe"===o.type) {
      let e="",t=Promise.resolve();
      for(const n of o.parts)t=t.then(()=>b(pi(q.restore(n),e)).then(t=>(e=t,e)));
      return t.catch(function(x) {
        return"sh: error: "+(x&&x.message||x)
      })
    }return(async function(n,r) {
      const i=(r&&r.cmd||n).trim();
      if(!i)return Promise.resolve("");
      const o=i.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
      if(o) {
        const t=o[1];
        let n=o[2];
        return n=v(n),g(t)?(e.lastExitCode=1,Promise.resolve("sh: "+t+": readonly variable")):(e.vars[t]=n,e.exported.includes(t)&&(e.env[t]=n),e.lastExitCode=0,Promise.resolve(""))
      }const c=i.split(/\s+/);
      if(0===c.length)return Promise.resolve("");
      const l=v(q.restore(c[0])),kt=["for","while","if","case","function"],kc=-1<kt.indexOf(l);
      const u=[];
      for(const _x of c.slice(1)){
        let r=kc?q.restore(_x):v(q.restore(_x));
        if(r.indexOf("$(")>-1)r=await expandC(r,false);
        r=(r.startsWith('"')&&r.endsWith('"'))||(r.startsWith("'")&&r.endsWith("'"))?r.slice(1,-1):r;
        u.push(r);
      }
      let f=s.execute(l,u);
      return Promise.resolve(f).then(n=> {
        if("__CLEAR__"===n)return t&&(t.innerHTML=""),e.lastExitCode=0,"";
        if("__BREAK__"===n||"__CONTINUE__"===n||"__RETURN__"===n)return e.lastExitCode=0,n;
        if("string"!=typeof n&&(n=String(n||"")),r.outputFile)try {
          const t=a(v(r.outputFile));
          let i=n;
          return r.append&&"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(t)&&(i=(webfs.read(t)||"")+n),"undefined"!=typeof webfs&&webfs.write&&webfs.write(t,i),e.lastExitCode=0,""
        }catch(t) {
          return e.lastExitCode=1,"sh: redirect error: "+t.message
        }return n&&(n.includes("command not found")||n.includes("error")||n.includes("failed"))?e.lastExitCode=1:e.lastExitCode=0,n
      }).catch(t=>(e.lastExitCode=1,"sh: error: "+t.message))
    })(o.cmd, function(e) {
      let t=e,n=!1,r=null;
      const i=t.match(/(>>)\s*(\S+)/);
      i&&(n=!0,r=i[2],t=t.replace(i[0],"").trim());
      const s=t.match(/(>)\s*(\S+)/);
      return s&&!n&&(r=s[2],t=t.replace(s[0],"").trim()), {
        cmd:t,append:n,outputFile:r
      }
    }(o.cmd))
  }async function S(e) {
    var n=e.trim();
    if(!n)return"";
    if(n.startsWith("#"))return"";
    if(n.indexOf("\n")>-1) {
      try {
        return await x(n)
      }catch(e) {
        return"sh: error: "+e.message
      }
    }
    var fnDef=n.match(/^([^\s{}();&|]+)\s*\(\)\s*\{([\s\S]*?)\}\s*(.*)$/);
    if(fnDef) {
      if(!window._state.functions)window._state.functions={};
      window._state.functions[fnDef[1]]=fnDef[2].trim();
      var rest=fnDef[3].trim();
      if(rest) {
        if(rest.charAt(0)===";")return S(rest.slice(1).trim());
        return S(rest)
      }
      return "function "+fnDef[1]+" defined"
    }
    var r=n.indexOf(" #");
    if(-1!==r) {
      var i=n.substring(0,r).trim();
      if(""===i)return"";
      e=n=i
    }if("clear"===n||"reset"===n)return t&&(t.innerHTML=""),"";
    if("exit"===n||"logout"===n)return"undefined"!=typeof webfs&&webfs.exit&&webfs.exit(),"";
    try {
      const e=await b(n);
      return"__BREAK__"===e||"__CONTINUE__"===e||"__RETURN__"===e?"":e||""
    }catch(e) {
      return"sh: error: "+e.message
    }
  }function needsContinuation(s){
  const t=String(s||"").replace(/#.*$/g,"");
  if(/\\\s*$/.test(t))return true;
  if((t.match(/\bif\b/g)||[]).length>(t.match(/\bfi\b/g)||[]).length)return true;
  if((t.match(/\bwhile\b/g)||[]).length+(t.match(/\bfor\b/g)||[]).length>(t.match(/\bdone\b/g)||[]).length)return true;
  if((t.match(/\bcase\b/g)||[]).length>(t.match(/\besac\b/g)||[]).length)return true;
  if((t.match(/{/g)||[]).length>(t.match(/}/g)||[]).length)return true;
  return false;
}
window.needsContinuation=needsContinuation;
function E() {
    if(o)return;
    if(!t||!n)return void setTimeout(E,100);
    o=!0,t.innerHTML="";
    const e=document.createElement("div");
    e.textContent='WemLinux v2.4 - Type "help" for available commands',t.appendChild(e);
    const s=document.createElement("div");
    s.textContent="$ ",t.appendChild(s),t.scrollTop=t.scrollHeight,n.disabled=!1,n.focus();
    let mlBuf="";
    function prmpt(){const d=document.createElement("div");d.textContent=mlBuf?"> ":"$ ";t.appendChild(d);t.scrollTop=t.scrollHeight}
    function outL(txt){if(txt&&""!==txt){const d=document.createElement("div");d.textContent=txt,t.appendChild(d)}}
    n.addEventListener("keydown",async function(ev){
      if(("c"===ev.key||"C"===ev.key)&&(ev.ctrlKey||ev.metaKey)){
        ev.preventDefault();this.value="";mlBuf="";
        const d=document.createElement("div");d.textContent="^C",t.appendChild(d);
        try{const o=emitSig("SIGINT");if(o)outL(o)}catch(x){}
        prmpt();return;
      }
      if("Enter"===ev.key){
        const v=this.value;
        if(!v.trim()&&!mlBuf){this.value="";prmpt();return}
        const d=document.createElement("div");d.textContent=(mlBuf?"> ":"$ ")+v,t.appendChild(d);
        let run=null;
        if(mlBuf){
          if(v.trim()===""||v.trim().toLowerCase()==="eof"){run=mlBuf;mlBuf=""}
          else{mlBuf+="\n"+v;if(!needsContinuation(mlBuf)){run=mlBuf;mlBuf=""}}
        }else{
          if(needsContinuation(v)){mlBuf=v;this.value="";prmpt();return}
          run=v;
        }
        if(run!==null){const s2=await S(run);outL(s2)}
        this.value="";prmpt();
        v.trim()&&(r.push(v.trim()),i=r.length)
      }
      "ArrowUp"===ev.key&&(ev.preventDefault(),r.length>0&&(i=Math.max(0,i-1),this.value=r[i]||"")),
      "ArrowDown"===ev.key&&(ev.preventDefault(),i<r.length-1?(i=Math.min(r.length-1,i+1),this.value=r[i]||""):(i=r.length,this.value=""))
    });
    document.addEventListener("click",()=> { n.disabled||n.focus() })
  }
function O() {
    (function() {
      if(s)return s;
      s=new c,s.register("cd",function(t) {
        if(t.length>1)return"cd: too many arguments\nTry 'cd --help' for more information.";
        let n=t[0]||"~";
        "~"===n&&(n=e.env.HOME||"/home"),"-"===n&&e.oldpwd&&(n=e.oldpwd);
        const r=a(n);
        return"undefined"!=typeof webfs&&webfs.isDir&&!webfs.isDir(r)?"cd: "+r+": No such file or directory":(e.oldpwd=e.cwd,e.cwd=r,e.env.OLDPWD=e.oldpwd,e.env.PWD=e.cwd,"")
      }),s.register("pwd",function() {
        return e.cwd
      }),s.register("ls",function(t) {
        for(var n= {
          all:!1,long:!1
        },r=e.cwd,i=0;
        i<t.length;
        i++) {
          var s=t[i];
          "-a"===s?n.all=!0:"-l"===s?n.long=!0:"-la"===s||"-al"===s?(n.all=!0,n.long=!0):s.startsWith("-")||(r=a(s))
        }if("undefined"==typeof webfs||!webfs.getFileList)return"bin  dev  etc  home  lib  proc  sbin  sys  tmp  usr  var";
        if(!webfs.isDir(r)) {
          if(webfs.fileExist(r)) {
            var o=r.split("/").pop();
            if(n.long) {
              var c=webfs.getFileSize(r)||0;
              return"-rw-r--r-- root root "+String(c).padStart(8)+" "+o
            }return o
          }return d("ls",r)
        }var u=webfs.getFileList(r)||[];
        Array.isArray(u)||(u=[]);
        for(var f=[],h=0;
        h<u.length;
        h++) {
          var p=u[h];
          p&&"string"==typeof p.name&&void 0!==p.name&&null!==p.name&&""!==p.name&&f.push(p)
        }if(u=f,!n.all) {
          for(var m=[],g=0;
          g<u.length;
          g++)u[g].name.startsWith(".")||m.push(u[g]);
          u=m
        }if(u.sort(function(e,t) {
          return e.name.localeCompare(t.name)
        }),n.long) {
          for(var w=[],v=0;
          v<u.length;
          v++) {
            var y=u[v],x=l(r+"/"+y.name),b=y.size||0;
            w.push(x+" root root "+String(b).padStart(8)+" "+y.name)
          }return w.join("\n")
        }for(var S=[],E=0;
        E<u.length;
        E++)S.push(u[E].name);
        return S.join("  ")
      }),s.register("echo",function(e) {
        let t=e.join(" "),n=!1,r=0;
        for(;
        r<e.length;
        )if("-e"===e[r])n=!0,r++;
        else if("-n"===e[r])r++;
        else {
          if("-E"!==e[r])break;
          n=!1,r++
        }return t=e.slice(r).join(" "),!n&&(t.includes("\\n")||t.includes("\\t")||t.includes("\\r")||t.includes("\\033")||t.includes("\\x1b"))&&(n=!0),n&&(t=t.replace(/\\n/g,"\n"),t=t.replace(/\\t/g,"\t"),t=t.replace(/\\r/g,"\r"),t=t.replace(/\\\\/g,"\\"),t=t.replace(/\\"/g,'"'),t=t.replace(/\\'/g,"'"),t=t.replace(/\\a/g,""),t=t.replace(/\\b/g,"\b"),t=t.replace(/\\v/g,"\v"),t=t.replace(/\\f/g,"\f"),t=t.replace(/\\e/g,""),t=t.replace(/\\0([0-7]{1,3})/g,(e,t)=>String.fromCharCode(parseInt(t,8))),t=t.replace(/\\x([0-9a-fA-F]{1,2})/g,(e,t)=>String.fromCharCode(parseInt(t,16))),t=function(e) {
          if(!e)return e;
          let t=e;
          const n= {
            30:"black",31:"red",32:"green",33:"yellow",34:"blue",35:"magenta",36:"cyan",37:"white",90:"gray",91:"lightred",92:"lightgreen",93:"lightyellow",94:"lightblue",95:"lightmagenta",96:"lightcyan",97:"white"
          };
          t=t.replace(/\x1b\[0m/g,"</span>");
          for(const[e,r]of Object.entries(n))t=t.replace(new RegExp("\\x1b\\["+e+"m","g"),'<span style="color:'+r+'">');
          return t
        }(t)),(t.startsWith('"')&&t.endsWith('"')||t.startsWith("'")&&t.endsWith("'"))&&(t=t.slice(1,-1)),t
      }),s/**
 * help - 显示命令帮助
 * @param {string[]} args - 可选：指定命令名查看详细用法
 * @returns {string} 帮助文本
 * @example
 * help ls
 */
.register("help", function(e) {
        var DESCRIPTIONS = {
    ".": "same as source",
    "alias": "define an alias",
    "awk": "AWK text processing",
    "base64": "Base64 encode/decode",
    "bash": "run a bash script",
    "bc": "calculator",
    "bg": "background job",
    "break": "break out of loop",
    "case": "conditional branch",
    "cat": "show file content",
    "cd": "change directory",
    "chmod": "change permissions",
    "chown": "change owner",
    "clad": "device debug",
    "clear": "clear screen",
    "command": "execute a command",
    "continue": "continue loop",
    "cp": "copy files",
    "curl": "HTTP request",
    "cut": "cut columns from text",
    "date": "show date/time",
    "dd": "copy data blocks",
    "declare": "declare a variable",
    "df": "disk usage",
    "dir": "list directory (same as ls)",
    "dirs": "directory stack",
    "dmesg": "kernel log",
    "do": "loop body",
    "done": "loop end",
    "du": "estimate directory usage",
    "echo": "print text",
    "ed": "line editor",
    "else": "else branch",
    "env": "show environment variables",
    "esac": "end of case",
    "eval": "re-evaluate",
    "exec": "execute replacement",
    "exit": "exit shell",
    "export": "export environment variable",
    "expr": "evaluate expression",
    "false": "return failure",
    "fg": "foreground job",
    "fi": "end of if",
    "find": "find files",
    "for": "loop",
    "free": "memory usage",
    "function": "define a function",
    "grep": "search text by pattern",
    "hash": "command hash",
    "head": "show beginning of file",
    "history": "command history",
    "hostname": "show hostname",
    "id": "show user identity",
    "if": "conditional branch",
    "ifconfig": "network interfaces",
    "jobs": "job list",
    "kill": "terminate process",
    "killall": "kill processes by name",
    "last": "login records",
    "let": "arithmetic evaluation",
    "linux64": "linux64 runner",
    "ln": "create links",
    "local": "define a local variable",
    "logout": "log out",
    "ls": "list directory contents",
    "mkdir": "create directory",
    "mount": "mount info",
    "mv": "move/rename files",
    "netstat": "network status",
    "nice": "adjust priority",
    "nslookup": "DNS query",
    "ping": "network connectivity test",
    "popd": "pop directory stack",
    "printf": "formatted output",
    "ps": "process list",
    "pushd": "push directory stack",
    "pwd": "show current directory",
    "read": "read input",
    "readonly": "mark variable read-only",
    "reset": "reset terminal",
    "return": "return from function",
    "rm": "remove files or directories",
    "rmdir": "remove empty directory",
    "sed": "stream editor",
    "sh": "run a shell script",
    "sha256sum": "compute SHA-256 digest",
    "sleep": "delay",
    "sort": "sort lines of text",
    "source": "execute script file",
    "stat": "show file status",
    "su": "switch user",
    "sudo": "run with elevated privileges",
    "tail": "show end of file",
    "test": "condition test",
    "then": "if branch body",
    "time": "time",
    "times": "show cumulative time",
    "top": "process monitor",
    "touch": "create/update timestamp",
    "tree": "display directory tree",
    "true": "return success",
    "type": "show command type",
    "typeset": "declare variable (same as declare)",
    "ulimit": "set or show resource limits",
    "umask": "default permission mask",
    "umount": "unmount",
    "unalias": "remove an alias",
    "uname": "show system info",
    "uniq": "deduplicate adjacent lines",
    "unset": "remove a variable",
    "uptime": "uptime",
    "w": "who is logged in",
    "wc": "count lines/words/bytes",
    "wget": "download files",
    "while": "conditional loop",
    "who": "logged-in users",
    "whoami": "show current user",
    "yes": "repeat output"
        };
        if (e.length > 0) {
            var name = e[0];
            if (s.has(name)) {
                var info = DESCRIPTIONS[name] || "shell builtin command";
                return name + ": " + info + "\nUsage: " + name + " [options] [arguments]";
            }
            return "bash: help: no help topics match '" + name + "'";
        }
        var cmds = s.registered.slice().sort();
        var lines = [
            "WemLinux shell, version 1.0.0(1)-release (aarch64-unknown-humminglinux)",
            "Powered by webfs - pure in-memory virtual file system",
            "These shell commands are defined internally. Type `help' to see this list.",
            "Type `help name' to find out more about the function `name'.",
            "",
            "Available commands (" + cmds.length + "):"
        ];
        var colWidth = 16;
        var row = [];
        for (var i = 0; i < cmds.length; i++) {
            var label = cmds[i] + " ".repeat(Math.max(0, colWidth - cmds[i].length));
            row.push(label);
            if (row.length === 3) { lines.push("  " + row.join("")); row = []; }
        }
        if (row.length > 0) lines.push("  " + row.join(""));
        return lines.join("\n");
      }),s.register("cat",function(e) {
        if(0===e.length)return f("cat");
        const t=a(e[0]);
        return"undefined"!=typeof webfs&&webfs.read?webfs.fileExist(t)?webfs.isDir(t)?"cat: "+t+": Is a directory":webfs.read(t)||"":d("cat",t):"cat: "+t+": No such file or directory"
      }),s.register("mkdir",function(e) {
        if(0===e.length)return f("mkdir");
        let t=!1,n=[];
        for(const r of e)if("-p"===r)t=!0;
        else {
          if(r.startsWith("-"))return p("mkdir",r);
          n.push(r)
        }if(0===n.length)return f("mkdir");
        let r=[];
        for(const i of n) {
          const n=a(i);
          if("undefined"==typeof webfs||!webfs.isDir)return"";
          if(webfs.isDir(n)) {
            if(!t)return"mkdir: cannot create directory '"+n+"': File exists"
          }else {
            if(webfs.fileExist(n))return"mkdir: cannot create directory '"+n+"': File exists";
            try {
              if(t) {
                const t=n.substring(0,n.lastIndexOf("/"));
                if(t&&!webfs.isDir(t)) {
                  const n=t.split("/");
                  let r="";
                  for(const t of n)if(t&&(r+="/"+t,!webfs.isDir(r)))try {
                    webfs.write(r+"/.placeholder","")
                  }catch(e) {
                    
                  }
                }
              }webfs.write(n+"/.placeholder",""),r.push("mkdir: created directory '"+n+"'")
            }catch(e) {
              return"mkdir: cannot create directory '"+n+"': Permission denied"
            }
          }
        }return r.join("\n")
      }),s.register("touch",function(e) {
        if(0===e.length)return f("touch");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.write)return"";
        try {
          return webfs.fileExist(t)?"touch: '"+t+"' timestamp updated":(webfs.write(t,""),"touch: created '"+t+"'")
        }catch(e) {
          return"touch: cannot touch '"+t+"': Permission denied"
        }
      }),s.register("sort",function(e) {
        if(0===e.length)return f("sort");
        for(var t= {
          numeric:!1,reverse:!1,unique:!1,ignoreCase:!1
        },n=[],r=0;
        r<e.length;
        r++) {
          var i=e[r];
          if("-n"===i)t.numeric=!0;
          else if("-r"===i)t.reverse=!0;
          else if("-u"===i)t.unique=!0;
          else if("-f"===i)t.ignoreCase=!0;
          else if("-nr"===i||"-rn"===i)t.numeric=!0,t.reverse=!0;
          else if("-ru"===i||"-ur"===i)t.reverse=!0,t.unique=!0;
          else if("-nu"===i||"-un"===i)t.numeric=!0,t.unique=!0;
          else {
            if(i.startsWith("-"))return p("sort",i);
            n.push(i)
          }
        }if(0===n.length)return f("sort");
        var s=a(n[0]);
        if("undefined"==typeof webfs||!webfs.read)return"sort: "+s+": No such file or directory";
        if(!webfs.fileExist(s))return d("sort",s);
        if(webfs.isDir(s))return"sort: "+s+": Is a directory";
        var o=(webfs.read(s)||"").split("\n").filter(function(e) {
          return""!==e.trim()
        });
        if(o.sort(function(e,n) {
          var r=function(e,n) {
            var r=e,i=n;
            if(t.ignoreCase&&(r=r.toLowerCase(),i=i.toLowerCase()),t.numeric) {
              var s=parseFloat(r),o=parseFloat(i);
              if(!isNaN(s)&&!isNaN(o))return s-o
            }return r.localeCompare(i)
          }(e,n);
          return t.reverse?-r:r
        }),t.unique) {
          for(var c=[],j2=0;
          j2<o.length;
          j2++)0!==j2&&o[j2]===o[j2-1]||c.push(o[j2]);
          o=c
        }return o.join("\n")
      }),s.register("sed",function(e) {
        if(0===e.length)return h("sed");
        for(var t=null,n=[],r=!1,i=0;
        i<e.length;
        i++) {
          var s=e[i];
          if("-n"!==s)if("-i"!==s)if("-e"!==s) {
            if(s.startsWith("-"))return p("sed",s);
            if(s.match(/^s\/.+\/.+\//))n.push(s);
            else if(s.match(/^s@.+@.+@/))n.push(s);
            else {
              if(!s.match(/^s,.+,.+,/)) {
                t=s;
                break
              }n.push(s)
            }
          }else i+1<e.length&&n.push(e[++i]);
          else r=!0
        }if(0===n.length&&null!==t) {
          var o=t;
          t=null;
          for(var c=i;
          c<e.length;
          c++)n.push(e[c]);
          n.unshift(o)
        }for(var a=[],l=i;
        l<e.length;
        l++)a.push(e[l]);
        if(0===a.length&&null!==t&&a.push(t),0===a.length)return h("sed");
        if(0===n.length)return h("sed");
        var u=a[0];
        if(u.startsWith("-"))return p("sed",u);
        const f=a[0];
        if("undefined"==typeof webfs||!webfs.read)return"sed: "+f+": No such file or directory";
        if(!webfs.fileExist(f))return m("sed",f);
        if(webfs.isDir(f))return"sed: "+f+": Is a directory";
        for(var d=(webfs.read(f)||"").split("\n"),h=0;
        h<n.length;
        h++) {
          var m=n[h],g=m.match(/^s([\/@,])/);
          if(!g) {
            var w=m.match(/^(\d+)\s*s([\/@,])/);
            if(w) {
              var v=parseInt(w[1]),y=w[2],x=m.indexOf(y,w[0].length-1),b=m.indexOf(y,x+1),S=m.substring(x+1,b),E=m.substring(b+1),O=E.match(/([gGiI]*)$/),I=O?O[1]:"";
              E=E.replace(/[gGiI]*$/,""),v>0&&v<=d.length&&(d[v-1]=d[v-1].replace(new RegExp(S,"g"+(I.includes("i")?"i":"")),E));
              continue
            }return"sed: invalid expression: "+m
          }var _,N=g[1],M=m.indexOf(N,1),k=m.indexOf(N,M+1),A=m.substring(M+1,k),T=m.substring(k+1),j=T.match(/([gGiI]*)$/),P=j?j[1]:"";
          if(T=T.replace(/[gGiI]*$/,""),-1===k||-1===M)return"sed: invalid expression: "+m;
          try {
            _=new RegExp(A,P.includes("i")?"gi":"g")
          }catch(e) {
            return"sed: invalid regex: "+A
          }for(var D=0;
          D<d.length;
          D++)P.includes("g"),d[D]=d[D].replace(_,T)
        }var R=d.join("\n");
        if(r) {
          try {
            webfs.write(f,R)
          }catch(e) {
            return"sed: cannot write to "+f+": "+e.message
          }return""
        }return R
      });
/* ===== v2.3.1 security: password store / protected dirs / glob ===== */
var WEMLINUX_PASS_KEY="wemlinux_passwd_hash";
function passHash(pw){var h=5381,s=String(pw==null?"":pw);for(var i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))|0;return"!"+(h>>>0).toString(36)+"x"}
function getPassHash(){try{if(typeof localStorage!=="undefined"&&localStorage.getItem){return localStorage.getItem(WEMLINUX_PASS_KEY)}}catch(e){}return null}
function setPassHash(h){try{if(typeof localStorage!=="undefined"&&localStorage.setItem)localStorage.setItem(WEMLINUX_PASS_KEY,h)}catch(e){}}
function clearPassHash(){try{if(typeof localStorage!=="undefined"&&localStorage.removeItem)localStorage.removeItem(WEMLINUX_PASS_KEY)}catch(e){}}
function passIsSet(){return!!getPassHash()}
function verifyPass(input){var h=getPassHash();return!!h&&passHash(input)===h}
function ensurePass(){if(passIsSet())return true;for(var tries=0;tries<3;tries++){var a1=null,a2=null;try{a1=prompt("First run: set the root password:")}catch(e){}try{a2=prompt("Re-enter to confirm:")}catch(e){}if(a1===null||a2===null)return false;if(a1===a2&&a1){setPassHash(passHash(a1));return true}}return false}
function authPass(ctx){if(!ensurePass())return false;var input=null;try{input=prompt(ctx||"Password required:")}catch(e){return false}return verifyPass(input||"")}
var PROTECTED_DIRS=["/data","/system","/vendor","/boot","/etc","/root","/bin","/dev","/sbin","/proc","/sys","/init","/apex","/product","/odm"];
function isProtectedPath(p){var raw=String(p||"");var n=raw.replace(/\/+$/,"");if(n===""||n==="/"||PROTECTED_DIRS.indexOf(n)>-1)return"self";for(var i=0;i<PROTECTED_DIRS.length;i++){if(n.indexOf(PROTECTED_DIRS[i]+"/")===0)return"child"}return null}
function globExpand(pat){if(typeof pat!=="string"||!/[*?\[\]]/.test(pat))return null;var abs=a(pat),slash=abs.lastIndexOf("/"),dir=slash<=0?"/":abs.slice(0,slash),base=abs.slice(slash+1);var entries=[];try{entries=webfs.getFileList(dir)||[]}catch(e){return[]}var re=null;try{re=new RegExp("^"+base.replace(/[.+^${}()|\[\]\\]/g,"\\$&").replace(/\*/g,"[^/]*").replace(/\?/g,"[^/]")+"$")}catch(e){return[]}var out=[];for(var i=0;i<entries.length;i++){if(re.test(entries[i].name))out.push(dir==="/"?"/"+entries[i].name:dir+"/"+entries[i].name)}return out}
s.register("rm",function(e) {
  if(0===e.length)return f("rm");
  var t={recursive:false,force:false},n=[];
  for(var r=0;r<e.length;r++) {
    var arg=e[r];
    if("-r"===arg||"-R"===arg)t.recursive=true;
    else if("-f"===arg)t.force=true;
    else if("-rf"===arg||"-fr"===arg)t.recursive=true,t.force=true;
    else {
      if(arg.indexOf("-")===0&&arg.length>1)return p("rm",arg);
      n.push(arg)
    }
  }
  if(0===n.length)return f("rm");
  /* glob 展开：堵住 rm -rf /* 与 rm -rf * 的绕过 */
  var targets=[];
  for(var s=0;s<n.length;s++) {
    var o=n[s],tg=globExpand(o);
    if(tg===null)tg=[a(o)];
    else if(tg.length===0){var patAbs=a(o),starIdx=patAbs.lastIndexOf("*"),patDir=starIdx>0?patAbs.slice(0,starIdx).replace(/\/+$/,""):patAbs;if(patDir==="")patDir="/";tg=[isProtectedPath(patDir)!==null?patDir:patAbs];}
    for(var m=0;m<tg.length;m++)targets.push(tg[m]);
  }
  /* 任一目标命中危险目录（本身或子路径）→ 必须密码验证 */
  var needAuth=false;
  for(var s2=0;s2<targets.length;s2++){if(isProtectedPath(targets[s2])!==null)needAuth=true}
  if(needAuth) {
    if(!authPass("Password required for rm:"))return window._sudoMode=false,"rm: Authentication failure";
  }
  var resetDone=false,msgs=[];
  for(var s3=0;s3<targets.length;s3++) {
    var c=targets[s3],prot=isProtectedPath(c);
    if(prot==="self") {
      /* 危险目录本身：密码已验证，允许递归删除（保留恢复出厂副作用，仅一次） */
      try {
        var u=webfs.getFileList(c)||[];
        Array.isArray(u)||(u=[]);
        for(var m2=0;m2<u.length;m2++) {
          var g=u[m2],v=c+"/"+g.name;
          if("directory"===g.type)(function e2(t2) {
            var n2=webfs.getFileList(t2)||[];
            Array.isArray(n2)||(n2=[]);
            for(var r2=0;r2<n2.length;r2++) {
              var i2=t2+"/"+n2[r2].name;
              if("directory"===n2[r2].type)e2(i2);
              else try{webfs.delFile(i2)}catch(e3){}
            }
            try{webfs.delFile(t2)}catch(e3){}
          })(v);
          else try{webfs.delFile(v)}catch(e3){}
        }
        try{webfs.delFile(c)}catch(e3){}
      }catch(e4) {}
      if(!resetDone) {
        resetDone=true;
        try {
          for(var y=["wemlinux","WemLinuxDB","TempRootDB"],x=0;x<y.length;x++)try{indexedDB.deleteDatabase(y[x])}catch(e5){}
          if("undefined"!=typeof localStorage)try{localStorage.clear()}catch(e5){}
          if("undefined"!=typeof sessionStorage)try{sessionStorage.clear()}catch(e5){}
          e&&(e.vars={},e.readonly=[],e.exported=[],e.aliases={},e.history=[],e.permissions={},e.ulimit={soft:256,hard:512,processes:[]},e.jobs=[],e.backgroundJobs=[],e.dirStack=[],e.functions={});
          try{clearPassHash()}catch(e5){}
        }catch(e5){}
        setTimeout(function(){"undefined"!=typeof webfs&&webfs.exit&&webfs.exit()},300);
      }
    } else if(prot==="child") {
      /* 危险目录子路径：密码已验证，允许删除 */
      if(!webfs.fileExist(c)){if(t.force)continue;return d("rm",c)}
      if(webfs.isDir(c)&&!t.recursive)return h("rm",c);
      if(webfs.isDir(c)&&t.recursive){w(c);try{webfs.delFile(c)}catch(e6){}}
      else try{webfs.delFile(c)}catch(e6){}
      if(!t.force)msgs.push("rm: removed '"+c+"'");
    } else {
      /* 普通路径 */
      if(!webfs.fileExist(c)){if(t.force)continue;return d("rm",c)}
      if(webfs.isDir(c)&&!t.recursive)return h("rm",c);
      if(webfs.isDir(c)&&t.recursive){w(c);try{webfs.delFile(c)}catch(e7){}}
      else try{webfs.delFile(c)}catch(e7){}
      if(!t.force)msgs.push("rm: removed '"+c+"'");
    }
  }
  return msgs.join("\n")
}),s.register("cp",function(e) {
        if(e.length<2)return f("cp");
        const t=a(e[0]),n=a(e[1]);
        if("undefined"==typeof webfs||!webfs.read||!webfs.write)return"cp: cannot copy '"+t+"' to '"+n+"'";
        if(!webfs.fileExist(t))return d("cp",t);
        if(webfs.isDir(t))return"cp: omitting directory '"+t+"'";
        const r=webfs.read(t);
        return null===r?"cp: failed to read '"+t+"'":(webfs.write(n,r),"cp: copied '"+t+"' -> '"+n+"'")
      }),s.register("mv",function(e) {
        if(e.length<2)return f("mv");
        const t=a(e[0]),n=a(e[1]);
        if("undefined"==typeof webfs||!webfs.read||!webfs.write||!webfs.delFile)return"mv: cannot move '"+t+"' to '"+n+"'";
        if(!webfs.fileExist(t))return d("mv",t);
        if(webfs.isDir(t))return"mv: cannot move directory '"+t+"'";
        const r=webfs.read(t);
        if(null===r)return"mv: failed to read '"+t+"'";
        let dest=n;
        if(webfs.isDir(n)||n.endsWith("/")) {
          const base=t.split("/").filter(Boolean).pop()||"";
          dest=(n.replace(/\/+$/,"")||"/")+"/"+base
        }
        return(webfs.write(dest,r),webfs.delFile(t),"mv: moved '"+t+"' -> '"+dest+"'")
      }),s.register("whoami",function() {
        return"root"
      }),s.register("id",function() {
        return"uid=0(root) gid=0(root) groups=0(root)"
      }),s.register("nohup",function(a){
  if(a.length===0)return f("nohup");
  var cmd=[],outFile="nohup.out";
  for(var i=0;i<a.length;i++){
    if(a[i]===">"){outFile=a[i+1]||"nohup.out";i++;continue}
    cmd.push(a[i]);
  }
  if(cmd.length===0)return"nohup: no command given";
  var r=bgStart(cmd.join(" "));
  if(!r.ok)return cmd.join(" ")+": "+r.error;
  r.proc.nohup=true;
  r.job.promise.then(function(out){
    if(out){try{var cur=(webfs.fileExist&&webfs.fileExist(outFile))?(webfs.read(outFile)||""):"";webfs.write(outFile,cur+out+"\n")}catch(x){}}
  });
  return"nohup: ignoring input and appending output to '"+outFile+"'";
}),s.register("systemctl",function(a){
  if(a.length===0)return f("systemctl");
  e.services=e.services||{};
  var sub=a[0],svc=a[1];
  if(sub==="list-units"||sub==="list"){
    var ks=Object.keys(e.services);
    if(ks.length===0)return"UNIT                      LOAD   ACTIVE   SUB";
    return"UNIT                      LOAD   ACTIVE   SUB\n"+ks.map(function(n){var s=e.services[n];return(n+".service").padEnd(26)+(s.status==="active"?"  loaded   active   running":"  loaded   inactive dead")}).join("\n");
  }
  if(sub==="status"){
    if(!svc)return"systemctl: no service given";
    var s=e.services[svc]||{};
    return"● "+svc+".service - "+(s.desc||svc)+"\n   Loaded: loaded (/etc/systemd/system/"+(svc||"")+".service; enabled)\n   Active: "+(s.status==="active"?"active (running)":"inactive (dead)")+(s.status==="active"?"\n   Main PID: "+s.pid:"");
  }
  if(sub==="start"){
    if(!svc)return"systemctl: no service given";
    e.services[svc]=e.services[svc]||{};
    var s=e.services[svc];s.status="active";s.pid=s.pid||allocPid();s.started=Date.now();s.desc=s.desc||svc;
    return"Job for "+svc+".service started.";
  }
  if(sub==="stop"){
    if(!svc)return"systemctl: no service given";
    var s=e.services[svc];if(!s)return"Failed to stop "+svc+".service: Unit not loaded.";
    s.status="inactive";return"Stopped "+svc+".service.";
  }
  if(sub==="restart"){
    if(!svc)return"systemctl: no service given";
    var s=e.services[svc]||(e.services[svc]={});s.status="active";s.pid=s.pid||allocPid();s.started=Date.now();
    return"Job for "+svc+".service restarted.";
  }
  if(sub==="enable"){
    if(!svc)return"systemctl: no service given";
    e.services[svc]=e.services[svc]||{};e.services[svc].enabled=true;
    return"Created symlink /etc/systemd/system/multi-user.target.wants/"+svc+".service.";
  }
  if(sub==="disable"){
    if(!svc)return"systemctl: no service given";
    if(e.services[svc])e.services[svc].enabled=false;
    return"Removed /etc/systemd/system/multi-user.target.wants/"+svc+".service.";
  }
  if(sub==="is-active"){
    if(!svc)return"systemctl: no service given";
    var s=e.services[svc];return s&&s.status==="active"?"active":"inactive";
  }
  return"systemctl: unknown action '"+sub+"'";
}),s.register("systemd",function(a){
  e.services=e.services||{};
  var ks=Object.keys(e.services);
  if(a.length&&a[0]==="--version")return"systemd 252 (252.19-wemlinux)\n+PAM +AUDIT +SELINUX +IMA +APPARMOR +SMACK +SYSVINIT +UTMP +LIBCRYPTSETUP +GCRYPT +GNUTLS +OPENSSL +ACL +XZ +LZ4 +ZSTD +BZIP2 +ELFUTILS +KMOD +IDN2 -IDN +PCRE2 default-hierarchy=unified";
  if(a.length&&a[0]==="analyze")return"Startup finished in 1.234s (kernel) + 2.345s (userspace) = 3.579s";
  if(a.length&&a[0]==="status")return"● humminglinux\n    State: running\n     Jobs: 0 queued\n   Failed: 0 units\n    Since: "+new Date().toString().slice(0,24)+"\n systemd: 252 running (HummingLinux)";
  return"systemd 252 running (HummingLinux)\nLoaded: "+(ks.length||0)+" services\n"+(ks.length?ks.map(function(n){return"  "+n+".service - "+(e.services[n].status==="active"?"running":"dead")}).join("\n"):"  (none)");
}),s.register("uname",function(e) {
        return 0===e.length?"HummingLinux":"-a"===e[0]?"HummingLinux "+(window._state&&window._state.env&&window._state.env.HOSTNAME||"humminglinux")+" 6.1.0-wemlinux #1 SMP PREEMPT aarch64 GNU/HummingLinux":"-s"===e[0]?"HummingLinux":"-n"===e[0]?(window._state&&window._state.env&&window._state.env.HOSTNAME||"humminglinux"):"-r"===e[0]?"6.1.0-wemlinux":"-m"===e[0]?"aarch64":"-o"===e[0]?"GNU/HummingLinux":"uname: invalid option '"+e[0]+"'"
      }),s.register("clear",function() {
        return t&&(t.innerHTML=""),"__CLEAR__"
      }),s.register("reset",function() {
        return t&&(t.innerHTML=""),"__CLEAR__"
      }),s.register("history",function() {
        return 0===r.length?"":r.map((e,t)=>String(t+1)+"  "+e).join("\n")
      }),s.register("exit",function() {
        return"undefined"!=typeof webfs&&webfs.exit&&webfs.exit(),""
      }),s.register("date",function() {
        return(new Date).toString()
      }),s.register("sleep",function(e) {
        if(0===e.length)return f("sleep");
        const t=parseFloat(e[0]);
        return isNaN(t)||t<0?"sleep: invalid time interval '"+e[0]+"'":new Promise(e=>setTimeout(()=>e(""),1e3*t))
      }),s.register("true",function() {
        return""
      }),s.register("false",function() {
        return"false: command failed"
      }),s.register("head",function(e) {
        if(0===e.length)return f("head");
        let t=10,n="";
        for(let r=0;
        r<e.length;
        r++)"-n"===e[r]&&r+1<e.length?t=parseInt(e[++r])||10:e[r].startsWith("-")||(n=e[r]);
        if(!n)return f("head");
        const r=a(n);
        return"undefined"!=typeof webfs&&webfs.read?webfs.fileExist(r)?webfs.isDir(r)?"head: "+r+": Is a directory":(webfs.read(r)||"").split("\n").slice(0,t).join("\n"):d("head",r):"head: "+r+": No such file or directory"
      }),s.register("tail",function(e) {
        if(0===e.length)return f("tail");
        let t=10,n="";
        for(let r=0;
        r<e.length;
        r++)"-n"===e[r]&&r+1<e.length?t=parseInt(e[++r])||10:e[r].startsWith("-")||(n=e[r]);
        if(!n)return f("tail");
        const r=a(n);
        return"undefined"!=typeof webfs&&webfs.read?webfs.fileExist(r)?webfs.isDir(r)?"tail: "+r+": Is a directory":(webfs.read(r)||"").split("\n").slice(-t).join("\n"):d("tail",r):"tail: "+r+": No such file or directory"
      }),s.register("grep",function(e) {
        if(e.length<2)return f("grep");
        let t="",n="",r=!1,i=!1,s=!1;
        for(let o=0;
        o<e.length;
        o++)"-i"===e[o]?r=!0:"-v"===e[o]?i=!0:"-n"===e[o]?s=!0:e[o].startsWith("-")||(t?n=e[o]:t=e[o]);
        if(!t||!n)return f("grep");
        const o=a(n);
        if("undefined"==typeof webfs||!webfs.read)return"grep: "+o+": No such file or directory";
        if(!webfs.fileExist(o))return d("grep",o);
        if(webfs.isDir(o))return"grep: "+o+": Is a directory";
        const c=(webfs.read(o)||"").split("\n"),l=r?new RegExp(t,"i"):new RegExp(t);
        let u=[];
        for(let e=0;
        e<c.length;
        e++)if(l.test(c[e])!==i) {
          const t=s?String(e+1)+":":"";
          u.push(t+c[e])
        }return u.join("\n")
      }),s.register("dd",function(e) {
        let t="/dev/zero",n="/dev/null",r="512",i="0";
        for(const s of e)s.startsWith("if=")?t=s.substring(3):s.startsWith("of=")?n=s.substring(3):s.startsWith("bs=")?r=s.substring(3):s.startsWith("count=")&&(i=s.substring(6));
        const s=parseInt(r)||512,o=parseInt(i)||0;
        return o+"+0 records in\n"+o+"+0 records out\n"+o*s+" bytes copied"
      }),s.register("su",function(e) {
  if(0===e.length)return"";
  var t=e[0];
  if("root"!==t)return"su: user "+t+" does not exist";
  if(!authPass("Password for root:"))return window._sudoMode=false,"su: Authentication failure";
  window._sudoMode=true;
  return""
}),s.register("case",function(e) {
        var t=e.join(" "),n=t.indexOf("in"),r=t.indexOf("esac");
        if(-1===n||-1===r)return"case: syntax error";
        for(var i=t.slice(0,n).trim(),s=t.slice(n+2,r).trim(),o=s.split(/\s*;;\s*/),c=!1,a=[],l=0;
        l<o.length;
        l++) {
          var u=o[l].match(/^([^)]+)\)\s*(.*)/s);
          if(u) {
            for(var f=u[1].split("|").map(function(e) {
              return e.trim()
            }),d=u[2].trim(),h=!1,p=0;
            p<f.length;
            p++) {
              var m="^"+f[p].trim().replace(/\*/g,".*").replace(/\?/g,".")+"$";
              try {
                if(new RegExp(m).test(i)) {
                  h=!0;
                  break
                }
              }catch(e) {
                
              }
            }if(h&&!c&&(c=!0,d)) {
              if("function"==typeof(v=b(d)).then)return v;
              v&&""!==v&&a.push(v)
            }
          }
        }if(!c) {
          var g=s.match(/\*\)\s*([^;]*)/);
          if(g) {
            var w=g[1].trim();
            if(w) {
              var v;
              if("function"==typeof(v=b(w)).then)return v;
              v&&""!==v&&a.push(v)
            }
          }
        }return a.join("\n")
      }),s.register("esac",function() {
        return""
      }),s.register("kill",function(t) {
        if(0===t.length)return f("kill");
        if(t[0]==="-l"){
          var rows=[" 1 SIGHUP"," 2 SIGINT"," 3 SIGQUIT"," 4 SIGILL"," 5 SIGTRAP"," 6 SIGABRT"," 7 SIGBUS"," 8 SIGFPE"," 9 SIGKILL","10 SIGUSR1","11 SIGSEGV","12 SIGUSR2","13 SIGPIPE","14 SIGALRM","15 SIGTERM","17 SIGCHLD","18 SIGCONT","19 SIGSTOP","20 SIGTSTP","21 SIGTTIN","22 SIGTTOU","28 SIGWINCH"];
          return rows.join("\n");
        }
        var sig="TERM",pids=[];
        for(var i=0;i<t.length;i++){
          var x=t[i];
          if(x.indexOf("-")===0&&x.length>1){
            var sn=x.slice(1);
            if(/^\d+$/.test(sn))sig=sn==="9"?"KILL":sn==="15"?"TERM":sn==="19"?"STOP":sn==="18"?"CONT":"TERM";
            else sig=sn.toUpperCase();
          } else if(/^\d+$/.test(x))pids.push(x);
        }
        if(pids.length===0)return f("kill");
        var out=[];
        for(var i=0;i<pids.length;i++){
          var pid=pids[i];
          if(pid===e.pid||pid==="1"){out.push("bash: kill: ("+pid+") - Operation not permitted");continue;}
          var p=null;for(var j=0;j<e.ulimit.processes.length;j++)if(String(e.ulimit.processes[j].pid)===pid){p=e.ulimit.processes[j];break;}
          if(!p||p.status==="exited"||p.status==="zombie"){out.push("bash: kill: ("+pid+") - No such process");continue;}
          if(sig==="STOP"){setProcStatus(p,"stopped");out.push("["+pid+"] stopped");}
          else if(sig==="CONT"){setProcStatus(p,"running");out.push("["+pid+"] continued");}
          else{setProcStatus(p,"exited");p.exitCode=128+(signalNum(sig)||15);out.push("kill: signal sent to PID "+pid);}
        }
        return out.join("\n");
      }),s.register("trap",function(t) {
        if(t.length===0){e.traps=e.traps||{};var ks=Object.keys(e.traps);return ks.length?ks.map(k=>"trap -- '"+e.traps[k]+"' "+k).join("\n"):"";}
        if(t[0]==="-l"){
          var rows=[" 1 SIGHUP"," 2 SIGINT"," 3 SIGQUIT"," 4 SIGILL"," 5 SIGTRAP"," 6 SIGABRT"," 7 SIGBUS"," 8 SIGFPE"," 9 SIGKILL","10 SIGUSR1","11 SIGSEGV","12 SIGUSR2","13 SIGPIPE","14 SIGALRM","15 SIGTERM","17 SIGCHLD","18 SIGCONT","19 SIGSTOP","20 SIGTSTP","21 SIGTTIN","22 SIGTTOU","28 SIGWINCH"];
          return rows.join("\n");
        }
        if(t[0]==="-"&&t.length>1){e.traps=e.traps||{};delete e.traps[t[1].toUpperCase()];return"";}
        if(t.length>=2&&t[0].indexOf("-")!==0){
          e.traps=e.traps||{};
          var cmd=(t[0].indexOf("'")===0||t[0].indexOf('"')===0)?t[0].slice(1,-1):t[0];
          for(var i=1;i<t.length;i++)e.traps[t[i].toUpperCase()]=cmd;
          return"";
        }
        return"trap: usage: trap [-l] ['command'] SIGNAL...";
      }),s.register("wait",function(t) {
        var bgs=e.backgroundJobs||[];
        var pids=t.filter(function(x){return/^\d+$/.test(x)});
        if(pids.length===0){
          var jobs=bgs.filter(function(j){return j.proc.status!=="exited"});
          if(jobs.length===0)return"";
          return Promise.all(jobs.map(function(j){return j.promise})).then(function(){return""});
        }
        var pend=pids.map(function(pid){var j=bgs.find(function(j){return String(j.proc.pid)===pid});return j?j.promise:Promise.resolve("")});
        return Promise.all(pend).then(function(){return""});
      }),s.register("killall",function(t) {
        if(0===t.length)return f("killall");
        const n=[];
        for(const e of t)e.startsWith("-")||n.push(e);
        if(0===n.length)return f("killall");
        let r=[];
        for(const t of n) {
          const n=e.ulimit.processes.filter(e=>e.name===t&&e.active);
          if(0===n.length)r.push("killall: "+t+": no process found");
          else for(const e of n)e.active=!1,r.push("killall: killed "+t+" (PID "+e.pid+")")
        }return r.join("\n")
      }),s.register("chmod",function(t) {
        if(t.length<2)return f("chmod");
        const n=t[0],r=a(t[1]);
        return/^[0-7]{3,4}$/.test(n)?"undefined"!=typeof webfs&&webfs.fileExist?webfs.fileExist(r)?(e.permissions[r]= {
          mode:n.padStart(3,"0"),owner:"root",group:"root"
        },"chmod: changed mode of '"+r+"' to "+n):d("chmod",r):"":"chmod: invalid mode '"+n+"'"
      }),s.register("chown",function(t) {
        if(t.length<2)return f("chown");
        const n=t[0],r=a(t[1]);
        if("undefined"==typeof webfs||!webfs.fileExist)return"";
        if(!webfs.fileExist(r))return d("chown",r);
        let i="root",s="root";
        if(n.includes(":")) {
          const e=n.split(":");
          i=e[0]||"root",s=e[1]||"root"
        }else i=n;
        const o=e.permissions[r]|| {
          mode:"755",owner:"root",group:"root"
        };
        return o.owner=i,o.group=s,e.permissions[r]=o,"chown: changed owner of '"+r+"' to "+i+":"+s
      }),s.register("mount",function() {
        return"rootfs on / type rootfs (rw)\n/dev/block/dm-0 on /system type ext4 (rw,relatime)\n/dev/block/dm-1 on /vendor type ext4 (rw,relatime)\ntmpfs on /dev type tmpfs (rw,nosuid,relatime)\nproc on /proc type proc (rw,relatime)\nsysfs on /sys type sysfs (rw,relatime)"
      }),s.register("umount",function(e) {
        return 0===e.length?f("umount"):"umount: "+e[0]+" unmounted"
      }),s.register("df",function() {
        const e=8388608,t=Math.floor(Math.random()*e*.6),n=e-t,r=Math.floor(t/e*100);
        return"Filesystem      Size  Used  Avail  Use%  Mounted on\n/dev/block/dm-0  "+String(e).padStart(8)+" "+String(t).padStart(8)+" "+String(n).padStart(8)+" "+String(r).padStart(4)+"%  /system"
      }),s.register("free",function() {
        const e=8388608,t=Math.floor(Math.random()*e*.5),n=e-t;
        return"              total        used        free      shared  buff/cache   available\nMem:      "+String(e).padStart(10)+" "+String(t).padStart(10)+" "+String(n).padStart(10)+" "+String(Math.floor(1024*Math.random()*1024)).padStart(10)+" "+String(Math.floor(1024*Math.random()*1024)).padStart(10)+" "+String(n+Math.floor(1024*Math.random()*1024)).padStart(10)+"\nSwap:     0           0           0"
      }),s.register("ps",function() {
        let t=["PID   TTY      TIME     CMD      STATUS"];
        t.push(e.pid+"   pts/0    00:00:01  bash     running");
        const n=e.ulimit.processes.filter(e=>e.active);
        for(const e of n.slice(0,5))t.push(e.pid+"   pts/0    00:00:00  "+(e.name||"proc")+"     "+(e.status||"running"));
        return t.join("\n")
      }),s.register("top",function() {
        let t=["PID  USER     PR  NI  VIRT  RES  SHR  S  %CPU  %MEM  TIME+  COMMAND"];
        t.push(e.pid+"  root     20   0  12.8m 4.2m 3.8m  S   0.0   0.1  0:00.01  bash");
        const n=e.ulimit.processes.filter(e=>e.active);
        const stc={"running":"R","sleeping":"S","stopped":"T","zombie":"Z","exited":"X"};
        for(const e of n.slice(0,5))t.push(e.pid+"  root     20   0  8.6m  2.1m 1.8m  "+(stc[e.status]||"S")+"   0.0   0.1  0:00.00  "+(e.name||"proc"));
        return t.join("\n")
      }),s.register("export",function(t) {
        if(0===t.length)return Object.keys(e.env).map(t=>"declare -x "+t+'="'+e.env[t]+'"').join("\n");
        for(const n of t)if(n.includes("=")) {
          const t=n.split("="),r=t[0],i=t.slice(1).join("=");
          if(g(r))return"export: "+r+": readonly variable";
          e.vars[r]=i,e.env[r]=i,e.exported.includes(r)||e.exported.push(r)
        }return""
      }),s.register("declare",function(t) {
        if(0===t.length)return Object.keys(e.vars).map(t=>"declare -- "+t+'="'+e.vars[t]+'"').join("\n");
        let n=!1,r=!1,i=!1;
        for(const s of t)if("-r"===s)n=!0;
        else if("-x"===s)r=!0;
        else if("-i"===s)i=!0;
        else {
          if(s.startsWith("-"))return p("declare",s);
           {
            let t=s,o="";
            if(s.includes("=")) {
              const e=s.split("=");
              t=e[0],o=e.slice(1).join("=")
            }n&&e.readonly.push(t),i?e.vars[t]=parseInt(o)||0:""!==o&&(e.vars[t]=o),r&&(e.env[t]=e.vars[t]||"",e.exported.includes(t)||e.exported.push(t))
          }
        }return[].join("\n")
      }),s.register("readonly",function(t) {
        if(0===t.length)return e.readonly.map(e=>"readonly "+e).join("\n");
        for(const n of t) {
          let t=n,r="";
          if(n.includes("=")) {
            const e=n.split("=");
            t=e[0],r=e.slice(1).join("=")
          }e.readonly.includes(t)||e.readonly.push(t),""!==r&&(e.vars[t]=r,e.env[t]=r)
        }return""
      }),s.register("unset",function(t) {
        if(0===t.length)return f("unset");
        let n=[];
        for(const r of t) {
          if(g(r)) {
            n.push("unset: "+r+": readonly variable");
            continue
          }delete e.vars[r],delete e.env[r];
          const t=e.exported.indexOf(r);
          t>-1&&e.exported.splice(t,1)
        }return n.join("\n")
      }),s.register("local",function(t) {
        if(0===t.length)return f("local");
        for(const n of t) {
          let t=n,r="";
          if(n.includes("=")) {
            const e=n.split("=");
            t=e[0],r=e.slice(1).join("=")
          }e.vars[t]=r||""
        }return""
      }),s.register("typeset",function(t) {
        if(0===t.length)return Object.keys(e.vars).map(t=>"typeset "+t+'="'+e.vars[t]+'"').join("\n");
        let n=!1,r=!1,i=!1;
        for(const s of t)if("-r"===s)n=!0;
        else if("-x"===s)r=!0;
        else if("-i"===s)i=!0;
        else {
          if(s.startsWith("-"))return p("typeset",s);
           {
            let t=s,o="";
            if(s.includes("=")) {
              const e=s.split("=");
              t=e[0],o=e.slice(1).join("=")
            }n&&e.readonly.push(t),i?e.vars[t]=parseInt(o)||0:""!==o&&(e.vars[t]=o),r&&(e.env[t]=e.vars[t]||"",e.exported.includes(t)||e.exported.push(t))
          }
        }return""
      }),s.register("alias",function(t) {
        if(0===t.length)return Object.keys(e.aliases).map(t=>"alias "+t+"='"+e.aliases[t]+"'").join("\n");
        for(const n of t)if(n.includes("=")) {
          const t=n.split("="),r=t[0],i=t.slice(1).join("=");
          e.aliases[r]=i.replace(/^['"]|['"]$/g,"")
        }return""
      }),s.register("unalias",function(t) {
        if(0===t.length)return f("unalias");
        if("-a"===t[0])return e.aliases= {
          
        },"";
        for(const n of t)delete e.aliases[n];
        return""
      }),s.register("type",function(t) {
        if(0===t.length)return f("type");
        const n=t[0];
        if(e.aliases&&e.aliases[n])return n+" is an alias for '"+e.aliases[n]+"'";
        if(e.functions&&e.functions[n])return n+" is a function";
        if(BUILTINS.includes(n)&&s.has(n))return n+" is a shell builtin";
        const p=whichPath(n);
        return p?n+" is "+p:n+" is not found"
      }),s.register("curl",function(e) {
        if(0===e.length)return f("curl");
        let t="",n="GET",r=null,i=null,s=!1;
        for(let o=0;
        o<e.length;
        o++)"-X"===e[o]&&o+1<e.length?n=e[++o].toUpperCase():"-d"===e[o]&&o+1<e.length?r=e[++o]:"-o"===e[o]&&o+1<e.length?i=e[++o]:"-v"===e[o]?s=!0:e[o].startsWith("-")||(t=e[o]);
        if(!t)return f("curl");
        try {
          const e=new URL(t),o= {
            method:n,headers: {
              "User-Agent":"curl/8.5.0"
            }
          };
          return r&&(o.body=r),fetch(t,o).then(e=>e.ok?e.text():"curl: (22) HTTP "+e.status).then(t=> {
            if(i) {
              const e=a(i);
              return"undefined"!=typeof webfs&&webfs.write&&webfs.write(e,t),"curl: saved to '"+i+"' ("+u(t.length)+")"
            }const r=2e3;
            return s?"* Connected to "+e.hostname+"\n> "+n+" "+e.pathname+" HTTP/1.1\n> Host: "+e.hostname+"\n>\n< HTTP/1.1 200 OK\n<\n"+(t.length>r?t.slice(0,r)+"\n... (truncated)":t):t.length>r?t.slice(0,r)+"\n... (truncated)":t
          }).catch(t=>"curl: (6) Could not resolve host: "+e.hostname+"\ncurl: error: "+t.message)
        }catch(e) {
          return"curl: (3) Invalid URL '"+t+"'"
        }
      }),s.register("wget",function(e) {
        if(0===e.length)return f("wget");
        let t="",n=null;
        for(let r=0;
        r<e.length;
        r++)"-O"===e[r]&&r+1<e.length?n=e[++r]:e[r].startsWith("-")||(t=e[r]);
        if(!t)return f("wget");
        try {
          return new URL(t),fetch(t).then(e=>e.ok?e.text():"wget: failed: HTTP "+e.status).then(e=> {
            const r=a(n||function(e) {
              const t=e.split("/");
              return t[t.length-1]||""
            }(t)||"index.html");
            return"undefined"!=typeof webfs&&webfs.write&&webfs.write(r,e),"wget: downloaded '"+t+"' -> '"+r+"' ("+u(e.length)+")"
          }).catch(e=>"wget: error: "+e.message)
        }catch(e) {
          return"wget: invalid URL '"+t+"'"
        }
      }),s.register("ping",function(e) {
        if(0===e.length)return f("ping");
        const t=e[0];
        let n=[];
        n.push("PING "+t+" (192.168.1.1) 56(84) bytes of data.");
        for(let e=0;
        e<4;
        e++) {
          const r=Math.floor(80*Math.random())+10,i=Math.floor(200*Math.random())+50;
          n.push("64 bytes from "+t+": icmp_seq="+String(e+1)+" ttl="+String(i)+" time="+String(r)+" ms")
        }return n.push("--- "+t+" ping statistics ---"),n.push("4 packets transmitted, 4 received, 0% packet loss, time 3000ms"),n.push("rtt min/avg/max/mdev = "+String(Math.floor(20*Math.random())+5)+"/"+String(Math.floor(30*Math.random())+20)+"/"+String(Math.floor(50*Math.random())+30)+"/"+String(Math.floor(10*Math.random()))+" ms"),n.join("\n")
      }),s.register("netstat",function() {
        return"Active Internet connections (servers and established)\nProto Recv-Q Send-Q Local Address           Foreign Address         State\ntcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN\ntcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN\ntcp        0      0 0.0.0.0:443             0.0.0.0:*               LISTEN\ntcp        0      0 192.168.1.100:22        192.168.1.1:54321       ESTABLISHED"
      }),s.register("ifconfig",function() {
        return"wlan0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 192.168.1.100  netmask 255.255.255.0  broadcast 192.168.1.255\n        ether 12:34:56:78:9a:bc  txqueuelen 1000  (Ethernet)\n        RX packets 56789  bytes 12345678 (11.7 MB)\n        TX packets 45678  bytes 8765432 (8.3 MB)"
      }),s.register("hostname",function(t) {
        return 0===t.length?e.env.HOSTNAME||"linux":t[0].startsWith("-")?"hostname: invalid option '"+t[0]+"'":(e.env.HOSTNAME=t[0],"")
      }),s.register("who",function() {
        return"root     pts/0        2024-01-01 10:00 (192.168.1.100)"
      }),s.register("w",function() {
        return"10:00:00 up 1 day,  1 user,  load average: 0.00, 0.01, 0.05\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\nroot     pts/0    192.168.1.100    10:00    0.00s  0.05s  0.01s bash"
      }),s.register("uptime",function() {
        const e=Math.floor(60*Math.random()*24*30)+60,t=Math.floor(e/86400),n=Math.floor(e%86400/3600),r=Math.floor(e%3600/60);
        let i="";
        return t>0&&(i+=String(t)+" day"+(t>1?"s":"")+", "),i+=String(n)+":"+String(r).padStart(2,"0")," 10:00:00 up "+i+",  1 user,  load average: 0.00, 0.01, 0.05"
      }),s.register("last",function() {
        return"root     pts/0        192.168.1.100   Mon Jan 1 10:00   still logged in\nroot     pts/0        192.168.1.100   Mon Jan 1 09:00 - 09:30  (00:30)"
      }),s.register("dmesg",function() {
        return"[    0.000000] Linux version 5.10.198-android\n[    0.000000] CPU: AArch64 Processor\n[    0.000000] Memory: 7856128K/8388608K available\n[    0.000000] Calibrating delay loop... 38.40 BogoMIPS"
      }),s.register("yes",function(e) {
        return((e.length>0?e.join(" "):"y")+"\n").repeat(20)
      }),s.register("test",function(e) {
        if(0===e.length)return f("test");
        const t=e.join(" ");
        if(/^!\s+/.test(t)||/\s+-a\s+/.test(t)||/\s+-o\s+/.test(t))return _evalTestExpr(t);
        return _singleTest(t)
      }),s.register("[",function(e) {
        const t=e.join(" ");
        return t.endsWith("]")?s.execute("test",[t.slice(0,-1).trim()]):"test: missing ]"
      }),s.register("]",function() {
        return""
      }),s.register("time",function(e) {
        if(0===e.length)return f("time");
        const t=Date.now();
        return e.join(" "),new Promise(e=> {
          setTimeout(()=> {
            const n=Date.now()-t;
            e("real\t"+(n/1e3).toFixed(3)+"s\nuser\t0.000s\nsys\t0.000s")
          },10)
        })
      }),s.register("times",function() {
        return"0m0.000s 0m0.000s\n0m0.000s 0m0.000s"
      }),s.register("dir",function(t) {
        const n=t.length>0?a(t[0]):e.cwd;
        if("undefined"==typeof webfs||!webfs.getFileList)return"bin  dev  etc  home  lib  proc  sbin  sys  tmp  usr  var";
        if(!webfs.isDir(n))return d("dir",n);
        var r=webfs.getFileList(n)||[];
        Array.isArray(r)||(r=[]);
        for(var i=[],s=0;
        s<r.length;
        s++) {
          var o=r[s];
          o&&"string"==typeof o.name&&void 0!==o.name&&null!==o.name&&""!==o.name&&i.push(o)
        }return(r=i).map(e=>e.name).join("  ")
      }),s.register("dirs",function() {
        return e.dirStack&&e.dirStack.length>0?e.dirStack.join(" "):"~"
      }),s.register("pushd",function(t) {
        if(0===t.length)return e.dirStack=e.dirStack||[],e.dirStack.push(e.cwd),e.dirStack.join(" ");
        const n=a(t[0]);
        return"undefined"!=typeof webfs&&webfs.isDir&&!webfs.isDir(n)?"pushd: "+n+": No such file or directory":(e.dirStack=e.dirStack||[],e.dirStack.push(e.cwd),e.cwd=n,e.dirStack.join(" "))
      }),s.register("popd",function() {
        return e.dirStack&&0!==e.dirStack.length?(e.cwd=e.dirStack.pop(),e.dirStack.join(" ")||"~"):"popd: directory stack empty"
      }),s.register("jobs",function() {
        const jl=e.backgroundJobs||[];
        if(0===jl.length)return"";
        return jl.map(j=>{
          let st=j.proc.status==="exited"?"Done":j.proc.status==="stopped"?"Stopped":"Running";
          return"["+j.num+"] "+st+"\t"+j.cmd;
        }).join("\n");
      }),s.register("bg",function() {
        const jl=e.backgroundJobs||[];
        if(0===jl.length)return"bg: no current job";
        const stp=jl.filter(j=>j.proc.status==="stopped");
        const num=stp.length?stp[stp.length-1].num:jl[jl.length-1].num;
        const j=jl.find(j=>j.num===num);
        if(!j)return"bg: job not found";
        if(j.proc.status==="stopped")setProcStatus(j.proc,"running");
        return"["+j.num+"] "+j.cmd+" &";
      }),s.register("fg",function() {
        const jl=e.backgroundJobs||[];
        if(0===jl.length)return"fg: no current job";
        const num=jl[jl.length-1].num;
        const j=jl.find(j=>j.num===num);
        if(!j)return"fg: job not found: "+num;
        if(j.proc.status==="stopped")setProcStatus(j.proc,"running");
        return j.promise.then(out=>{return j.cmd+(out?"\n"+out:"")});
      }),s.register("logout",function() {
        return"undefined"!=typeof webfs&&webfs.exit&&webfs.exit(),""
      }),s.register("ulimit",function(a){
  var soft=e.ulimit.soft,hard=e.ulimit.hard,showAll=false,which="S",setSoft=null,setHard=null;
  for(var i=0;i<a.length;i++){
    var arg=a[i];
    if(arg==="-a")showAll=true;
    else if(arg==="-S")which="S";
    else if(arg==="-H")which="H";
    else if(arg==="-n"||arg==="-f"||arg==="-s"){/* resource name: value follows or display only */}
    else if(/^\d+$/.test(arg)){var val=parseInt(arg,10);if(which==="H")setHard=val;else setSoft=val;}
    else return"ulimit: invalid option '"+arg+"'\nTry 'ulimit --help' for more information.";
  }
  if(showAll)return"open files                    (-n) "+soft+"\nopen files (hard limit)       (-Hn) "+hard+"\nmax user processes            (-u) "+soft+"\nvirtual memory                (-v) unlimited\ncpu time                      (-t) unlimited\nfile size                     (-f) unlimited";
  if(setHard!==null){if(setHard<soft)return"ulimit: cannot set hard limit below soft limit";hard=setHard;e.ulimit.hard=hard;}
  if(setSoft!==null){if(setSoft>hard)return"ulimit: cannot set soft limit above hard limit";soft=setSoft;e.ulimit.soft=soft;}
  return which==="H"?String(hard):String(soft);
}),s.register("umask",function() {
        return"0022"
      }),s.register("printf",function(e) {
        if(0===e.length)return f("printf");
        const t=e[0],n=e.slice(1);
        let r=t,i=0;
        return r=r.replace(/%s/g,()=>n[i++]||""),i=0,r=r.replace(/%d/g,()=>String(parseInt(n[i++])||0)),r=r.replace(/\\n/g,"\n"),r=r.replace(/\\t/g,"\t"),r
      }),s.register("read",function(t) {
        if(0===t.length)return f("read");
        const n=t[0],r=prompt("> ");
        return null!==r&&(e.vars[n]=r),""
      }),s.register("base64",function(e) {
        if(0===e.length)return f("base64");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"base64: "+t+": No such file";
        if(!webfs.fileExist(t))return d("base64",t);
        if(webfs.isDir(t))return"base64: "+t+": Is a directory";
        const n=webfs.read(t)||"";
        try {
          return btoa(n)
        }catch(e) {
          return"base64: invalid input data"
        }
      }),s.register("sha256sum",function(e) {
        if(0===e.length)return f("sha256sum");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"sha256sum: "+t+": No such file";
        if(!webfs.fileExist(t))return d("sha256sum",t);
        if(webfs.isDir(t))return"sha256sum: "+t+": Is a directory";
        const n=webfs.read(t)||"";
        try {
          const t=(new TextEncoder).encode(n);
          return crypto.subtle.digest("SHA-256",t).then(t=>Array.from(new Uint8Array(t)).map(e=>e.toString(16).padStart(2,"0")).join("")+"  "+e[0])
        }catch(e) {
          return"sha256sum: error calculating hash"
        }
      }),s.register("clad",function() {
  try{if(typeof confirm==="function"&&!confirm("Clear all WemLinux data? The page will refresh automatically"))return"clad: cancelled"}catch(e){}
  try{clearPassHash()}catch(e){}
  var dbs=["wemlinux","WemLinuxDB","TempRootDB"];
  return new Promise(function(res) {
    function next(i) {
      if(i>=dbs.length) {
        try{setTimeout(function(){try{location.reload()}catch(e){}},300)}catch(e){}
        res("clad: all data cleared, refreshing page...");
        return;
      }
      try {
        var req=indexedDB.deleteDatabase(dbs[i]);
        req.onsuccess=function(){next(i+1)};
        req.onerror=function(){next(i+1)};
        req.onblocked=function(){next(i+1)};
      }catch(e) { next(i+1) }
    }
    next(0);
  })
}),s.register("if",function(e) {
        const t=e.join(" "),n=t.indexOf("then"),r=t.indexOf("fi");
        if(-1===n||-1===r)return"if: syntax error";
        const i=v(t.slice(0,n).replace(/;\s*$/,"").trim()),o=t.slice(n+4,r).trim(),c=i.split(/\s+/);
        if(0===c.length)return"if: missing condition";
        const a=c[0],l=c.slice(1),u=s.execute(a,l);
        return Promise.resolve(u).then(e=> {
          const t=""===e||null==e||"0"===e||0===e;
          if(t&&o) {
            const e=o.indexOf("else"),t=e>-1?o.slice(0,e).trim():o;
            if(t)return b(t)
          }const n=o.indexOf("else");
          if(!t&&n>-1) {
            const e=o.slice(n+4).trim();
            if(e)return b(e)
          }return""
        })
      }),s.register("then",function() {
        return""
      }),s.register("else",function() {
        return""
      }),s.register("fi",function() {
        return""
      }),s.register("while",function(e) {
        const t=e.join(" "),n=t.indexOf("do"),r=t.indexOf("done");
        if(-1===n||-1===r)return"while: syntax error";
        const i=t.slice(0,n).replace(/;\s*$/,"").trim(),o=t.slice(n+2,r).trim();
        let c=[],a=0;
        return new Promise(e=> {
          !function t() {
            if(a>=100)return void e(c.join("\n"));
            const n=v(i).split(/\s+/);
            if(0===n.length)return void e(c.join("\n"));
            const r=s.execute(n[0],n.slice(1));
            Promise.resolve(r).then(n=> {
              if(""===n||null==n||"0"===n)if(o) {
                const pb=b(o);
                Promise.resolve(pb).then(out=> {
                  const brk="__BREAK__"===out||out&&-1!==out.indexOf("__BREAK__");
                  if(out) {
                    const cl=(out||"").split("\n").filter(x=>"__BREAK__"!==x&&"__CONTINUE__"!==x).join("\n");
                    cl&&c.push(cl)
                  }if(brk)return e(c.join("\n"));
                  a++,setTimeout(t,50)
                })
              }else a++,setTimeout(t,50);
              else e(c.join("\n"))
            })
          }()
        })
      }),s.register("do",function() {
        return""
      }),s.register("done",function() {
        return""
      }),s.register("for",function(t) {
        const n=t.join(" "),r=n.indexOf("in"),i=n.indexOf("do"),s=n.indexOf("done");
        if(-1===r||-1===i||-1===s)return"for: syntax error";
        const o=n.slice(0,r).trim(),c=n.slice(r+2,i).replace(/;\s*$/,"").trim(),a=n.slice(i+2,s).replace(/;\s*$/,"").trim(),l=c.split(/\s+/);
        let u=[],f=0;
        return new Promise(t=> {
          !function n() {
            if(f>=l.length)return void t(u.join("\n"));
            const r=l[f];
            if(e.vars[o]=r,a) {
              const e=b(a);
              Promise.resolve(e).then(e=> {
                const brk="__BREAK__"===e||e&&-1!==e.indexOf("__BREAK__");
                if(e) {
                  const cl=(e||"").split("\n").filter(x=>"__BREAK__"!==x&&"__CONTINUE__"!==x).join("\n");
                  cl&&u.push(cl)
                }if(brk)return t(u.join("\n"));
                f++,setTimeout(n,50)
              })
            }else f++,setTimeout(n,50)
          }()
        })
      }),s.register("break",function(t) {
        const n=t.length>0&&parseInt(t[0])||1;
        return e.breakLevel=n,"__BREAK__"
      }),s.register("continue",function(t) {
        const n=t.length>0&&parseInt(t[0])||1;
        return e.continueLevel=n,"__CONTINUE__"
      }),s.register("function",function(t) {
        if(t.length<2)return"function: syntax error";
        const n=t[0].replace(/\(\)$/,""),r=t.slice(1).join(" "),i=r.indexOf("{");
        if(-1===i)return"function: syntax error near '"+n+"'";
        const s=r.slice(i+1).trim(),o=s.lastIndexOf("}"),c=o>-1?s.slice(0,o).trim():s;
        return e.functions||(e.functions= {
          
        }),e.functions[n]=c,"function "+n+" defined"
      }),s.register("return",function(e) {
        return e.length>0&&parseInt(e[0]),"__RETURN__"
      }),s.register("command",function(e) {
        if(0===e.length)return f("command");
        if("-v"===e[0]&&e.length>1) {
          const t=e[1];
          return s.has(t)?t+" is a shell builtin":"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist("/system/bin/"+t)?"/system/bin/"+t:""
        }if("-V"===e[0]&&e.length>1) {
          const t=e[1];
          return s.has(t)?t+" is a shell builtin":"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist("/system/bin/"+t)?t+" is /system/bin/"+t:t+": command not found"
        }return b(e.join(" "))
      }),s.register("nice",function(e) {
        if(0===e.length)return f("nice");
        let t=10,n="";
        for(let r=0;
        r<e.length;
        r++)if("-n"===e[r]&&r+1<e.length)t=parseInt(e[++r])||10;
        else if(!e[r].startsWith("-")) {
          n=e.slice(r).join(" ");
          break
        }return n?b(n):f("nice")
      }),s.register("uniq",function(e) {
        if(0===e.length)return f("uniq");
        const t= {
          count:!1,repeated:!1,unique:!1
        };
        let n="",r="";
        for(let i=0;
        i<e.length;
        i++) {
          const s=e[i];
          if("-c"===s)t.count=!0;
          else if("-d"===s)t.repeated=!0;
          else if("-u"===s)t.unique=!0;
          else {
            if(s.startsWith("-"))return p("uniq",s);
            n?r=s:n=s
          }
        }if(!n)return f("uniq");
        const i=a(n);
        if("undefined"==typeof webfs||!webfs.read)return"uniq: "+i+": No such file or directory";
        if(!webfs.fileExist(i))return d("uniq",i);
        if(webfs.isDir(i))return"uniq: "+i+": Is a directory";
        const s=(webfs.read(i)||"").split("\n").filter(e=>""!==e.trim()),o= {
          
        };
        for(const e of s)o[e]=(o[e]||0)+1;
        let c=[];
        for(const[e,n]of Object.entries(o))t.repeated&&1===n||t.unique&&n>1||c.push(t.count?n+" "+e:e);
        const l=c.join("\n");
        if(r) {
          const e=a(r);
          return"undefined"!=typeof webfs&&webfs.write&&webfs.write(e,l),""
        }return l
      }),s/**
 * wc - 统计文件行数、字数、字节数
 * @param {string[]} args - 参数列表（支持 -l -w -c 组合）
 * @returns {string} 统计结果
 * @example
 * wc -l /etc/hostname
 */
.register("wc",function(e) {
        if (0 === e.length) return f("wc");
        var t = { lines: false, words: false, bytes: false, chars: false };
        var files = [];
        for (var i = 0; i < e.length; i++) {
          var a0 = e[i];
          if (a0 === "-l") t.lines = true;
          else if (a0 === "-w") t.words = true;
          else if (a0 === "-c") t.bytes = true;
          else if (a0 === "-m") t.chars = true;
          else if (a0.startsWith("-")) return p("wc", a0);
          else files.push(a0);
        }
        if (files.length === 0) return f("wc");
        if (!t.lines && !t.words && !t.bytes && !t.chars) t.lines = t.words = t.bytes = true;
        var out = [];
        var totalL = 0, totalW = 0, totalB = 0;
        for (var j = 0; j < files.length; j++) {
          var fp = a(files[j]);
          if (!webfs.fileExist(fp)) return d("wc", files[j]);
          if (webfs.isDir(fp)) return "wc: " + fp + ": Is a directory";
          var content = webfs.read(fp) || "";
          var lc = content.split("\n").length - 1;
          var wc_ = (content.trim() === "" ? 0 : content.trim().split(/\s+/).length);
          var bc = content.length;
          totalL += lc; totalW += wc_; totalB += bc;
          var parts = [];
          if (t.lines) parts.push(String(lc).padStart(7));
          if (t.words) parts.push(String(wc_).padStart(7));
          if (t.bytes) parts.push(String(bc).padStart(7));
          if (t.chars) parts.push(String(content.length).padStart(7));
          out.push(parts.join("") + " " + files[j]);
        }
        if (files.length > 1) {
          var tp = [];
          if (t.lines) tp.push(String(totalL).padStart(7));
          if (t.words) tp.push(String(totalW).padStart(7));
          if (t.bytes) tp.push(String(totalB).padStart(7));
          if (t.chars) tp.push(String(totalB).padStart(7));
          out.push(tp.join("") + " total");
        }
        return out.join("\n");
      }),s/**
 * tree - 以树状结构递归显示目录内容
 * @param {string[]} args - 参数列表（目录路径，默认当前目录）
 * @returns {string} 目录树
 * @example
 * tree /etc
 */
.register("tree",function(e) {
        var showHidden = false;
        var dir = e.cwd;
        for (var i = 0; i < e.length; i++) {
          if (e[i] === "-a") showHidden = true;
          else if (e[i].startsWith("-")) return p("tree", e[i]);
          else dir = e[i];
        }
        var rootPath = a(dir);
        if (!webfs.isDir(rootPath)) return d("tree", dir);
        var linesOut = [rootPath];
        (function walk(path, prefix) {
          var items = webfs.getFileList(path);
          items.sort(function(x, y) { return x.name.localeCompare(y.name); });
          var visible = items.filter(function(it) { return showHidden || !it.name.startsWith("."); });
          for (var k = 0; k < visible.length; k++) {
            var it = visible[k];
            var isLast = k === visible.length - 1;
            var connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
            linesOut.push(prefix + connector + it.name + (it.type === "directory" ? "/" : ""));
            if (it.type === "directory") {
              walk(path + "/" + it.name, prefix + (isLast ? "    " : "\u2502   "));
            }
          }
        })(rootPath, "");
        return linesOut.join("\n");
      }),s/**
 * du - 统计文件或目录的磁盘占用
 * @param {string[]} args - 参数列表（支持 -s -h，路径默认当前目录）
 * @returns {string} 占用大小
 * @example
 * du -s /etc
 */
.register("du",function(e) {
        var sum = false, human = false;
        var target = (window._state&&window._state.cwd)||"/";
        for (var i = 0; i < e.length; i++) {
          if (e[i] === "-s") sum = true;
          else if (e[i] === "-h") human = true;
          else if (e[i].startsWith("-")) return p("du", e[i]);
          else target = e[i];
        }
        var tp = a(target);
        if (!webfs.fileExist(tp)) return d("du", target);
        var total = 0;
        (function walk(path) {
          if (webfs.isDir(path)) {
            var items = webfs.getFileList(path);
            for (var j = 0; j < items.length; j++) {
              var child = path + "/" + items[j].name;
              if (items[j].type === "directory") walk(child);
              else total += webfs.getFileSize(child) || 0;
            }
          } else {
            total += webfs.getFileSize(path) || 0;
          }
        })(tp);
        if (sum) return (human ? u(total) : total) + "\t" + tp;
        if (!webfs.isDir(tp)) return (human ? u(total) : total) + "\t" + tp;
        var out2 = [];
        (function walk2(path, indent) {
          var items = webfs.getFileList(path);
          for (var j2 = 0; j2 < items.length; j2++) {
            var child2 = path + "/" + items[j2].name;
            if (items[j2].type === "directory") {
              var size = 0;
              (function walk3(p) {
                if (webfs.isDir(p)) {
                  var it3 = webfs.getFileList(p);
                  for (var k3 = 0; k3 < it3.length; k3++) {
                    var c3 = p + "/" + it3[k3].name;
                    if (it3[k3].type === "directory") walk3(c3);
                    else size += webfs.getFileSize(c3) || 0;
                  }
                }
              })(child2);
              out2.push((human ? u(size) : size) + "\t" + child2);
              walk2(child2, indent + 1);
            }
          }
        })(tp, 0);
        return out2.join("\n");
      }),s/**
 * stat - 显示文件或目录的详细信息
 * @param {string[]} args - 参数列表（路径）
 * @returns {string} 文件元信息
 * @example
 * stat /etc/hostname
 */
.register("stat",function(e) {
        if (e.length === 0) return f("stat");
        var f2 = a(e[0]);
        var st = webfs.stat(f2);
        if (!st) return d("stat", e[0]);
        var modeStr = (st.type === "dir" ? "d" : "-") + (st.mode || "0644");
        return "  File: " + f2 + "\n  Size: " + st.size + "    Type: " + (st.type === "dir" ? "directory" : "regular file") +
               "\n  Mode: " + modeStr + "    Owner: " + st.owner + "    Group: " + st.group +
               "\n  Modified: " + new Date(st.mtime).toString();
      }),s/**
 * ln - 创建硬链接或符号链接
 * @param {string[]} args - 参数列表（-s 创建符号链接）
 * @returns {string} 创建结果
 * @example
 * ln -s /etc/hostname /tmp/hostlink
 */
.register("ln",function(e) {
        if (e.length < 2) return f("ln");
        var sym = false;
        var args = e.slice();
        if (args[0] === "-s") { sym = true; args.shift(); }
        if (args.length < 2) return f("ln");
        var target2 = args[0], link = args[1];
        var tp2 = a(target2);
        if (!webfs.fileExist(tp2)) return d("ln", target2);
        var lp = a(link);
        var parentP = lp.substring(0, lp.lastIndexOf("/")) || "/";
        if (!webfs.isDir(parentP)) return "ln: cannot create symbolic link '" + lp + "': No such file or directory";
        var name2 = lp.split("/").filter(Boolean).pop();
        var mode3 = webfs.stat(tp2) ? webfs.stat(tp2).mode : "0644";
        if (sym) {
          // 软链接：内容存目标路径
          webfs.write(lp, "LINK:" + tp2);
        } else {
          var content2 = webfs.read(tp2);
          if (content2 === null) return "ln: failed to read '" + tp2 + "'";
          webfs.write(lp, content2);
        }
        return "ln: created link '" + lp + "' -> '" + tp2 + "'";
      }),s/**
 * find - 在目录树中按名称查找文件
 * @param {string[]} args - 参数列表（路径 + -name 通配符模式）
 * @returns {string} 匹配的文件路径列表
 * @example
 * find /home -name "*.txt"
 */
.register("find",function(e) {
        if (e.length === 0) return f("find");
        var base = ".";
        var namePat = null;
        var args2 = [];
        for (var i2 = 0; i2 < e.length; i2++) {
          if (e[i2] === "-name" && i2 + 1 < e.length) { namePat = e[i2 + 1].replace(/^["']|["']$/g, ""); i2++; }
          else if (e[i2].startsWith("-")) return p("find", e[i2]);
          else base = e[i2];
        }
        var bp = a(base);
        if (!webfs.isDir(bp)) return d("find", base);
        var out3 = [];
        (function walk4(path) {
          var items4 = webfs.getFileList(path);
          for (var j4 = 0; j4 < items4.length; j4++) {
            var full = path === "/" ? path + items4[j4].name : path + "/" + items4[j4].name;
            if (namePat) {
              var re2 = new RegExp("^" + namePat.split("*").join("\u0000").split("?").join("\u0001").replace(/[.+^${}()|[\]\\]/g, "\\$&").split("\u0000").join(".*").split("\u0001").join(".") + "$");
              if (re2.test(items4[j4].name)) out3.push(full);
            } else {
              out3.push(full);
            }
            if (items4[j4].type === "directory") walk4(full);
          }
        })(bp);
        return out3.join("\n");
      }),
s.register("cut",function(e) {
        if(0===e.length)return f("cut");
        let t="\t",n=[],r="";
        for(let i=0;
        i<e.length;
        i++) {
          const s=e[i];
          if("-d"===s&&i+1<e.length)t=e[++i];
          else if("-f"===s&&i+1<e.length)n=e[++i].split(",").map(e=>parseInt(e.trim())).filter(e=>!isNaN(e));
          else {
            if(s.startsWith("-"))return p("cut",s);
            r=s
          }
        }if(0===n.length)return"cut: missing field list";
        if(!r)return f("cut");
        const i=a(r);
        if("undefined"==typeof webfs||!webfs.read)return"cut: "+i+": No such file or directory";
        if(!webfs.fileExist(i))return d("cut",i);
        if(webfs.isDir(i))return"cut: "+i+": Is a directory";
        const s=(webfs.read(i)||"").split("\n");
        let o=[];
        for(const e of s) {
          if(""===e.trim())continue;
          const r=e.split(t);
          let i=[];
          for(const e of n)e<=r.length&&i.push(r[e-1]);
          o.push(i.join(t))
        }return o.join("\n")
      }),s.register("env",function(t) {
        if(0===t.length)return Object.keys(e.env).map(t=>t+"="+e.env[t]).join("\n");
        let n="",r= {
          
        };
        for(let e=0;
        e<t.length;
        e++) {
          if(!t[e].includes("=")) {
            n=t.slice(e).join(" ");
            break
          } {
            const n=t[e].split("=");
            r[n[0]]=n.slice(1).join("=")
          }
        }if(n) {
          const t=Object.assign( {
            
          },e.env);
          Object.assign(e.env,r);
          const i=b(n);
          return Object.assign(e.env,t),i
        }return""
      }),s.register("awk",function(e) {
        if(e.length<2)return f("awk");
        let t="",n="",r=0;
        for(;
        r<e.length;
        )"-F"===e[r]&&r+1<e.length?r+=2:t||e[r].startsWith("-")?(e[r].startsWith("-")||(n=e[r]),r++):(t=e[r],r++);
        if(!t)return f("awk");
        if(!n)return f("awk");
        const i=a(n);
        if("undefined"==typeof webfs||!webfs.read)return"awk: "+i+": No such file or directory";
        if(!webfs.fileExist(i))return d("awk",i);
        if(webfs.isDir(i))return"awk: "+i+": Is a directory";
        const s=(webfs.read(i)||"").split("\n").filter(e=>""!==e.trim());
        let o=[];
        for(let e=0;
        e<s.length;
        e++) {
          const n=s[e].split(/\s+/);
          let r=t;
          for(let e=0;
          e<n.length;
          e++)r=r.replace(new RegExp("\\$"+(e+1),"g"),n[e]);
          r=r.replace(/\$0/g,s[e]),r=r.replace(/NR/g,String(e+1)),r=r.replace(/NF/g,String(n.length));
          try {
            const e=Function('"use strict"; return ('+r+")")();
            void 0!==e&&o.push(String(e))
          }catch(e) {
            o.push("awk: error: "+e.message)
          }
        }return o.join("\n")
      }),s.register("hash",function(t) {
        if(0===t.length) {
          const e=s.registered||[];
          let t=["hits\tcommand"];
          for(const n of e.slice(0,20))t.push("0\t"+n);
          return t.join("\n")
        }if("-r"===t[0])return"";
        if("-p"===t[0]&&t.length>2) {
          const n=t[1],r=t[2];
          return e.vars["__hash_"+r]=n,""
        }let n=[];
        for(const r of t)if(!r.startsWith("-")) {
          const t=e.vars["__hash_"+r];
          t?n.push(t):s.has(r)?n.push(r+" is a shell builtin"):n.push("hash: "+r+": not found")
        }return n.join("\n")
      }),s.register("bc",function(e) {
        if(0===e.length)return f("bc");
        var t=e.join(" ");
        try {
          t=t.replace(/^["']|["']$/g,"");
          var n=Function('"use strict"; return ('+t+")")();
          return String(n)
        }catch(e) {
          return"bc: expression error: "+e.message
        }
      }),s.register("ed",function(e) {
        if(0===e.length)return f("ed");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"ed: "+t+": No such file or directory";
        if(!webfs.fileExist(t))return d("ed",t);
        if(webfs.isDir(t))return"ed: "+t+": Is a directory";
        const n=webfs.read(t)||"";
        return n+"\ned: file loaded, "+n.split("\n").length+" lines"
      }),s.register("nslookup",function(e) {
        if(0===e.length)return f("nslookup");
        const t=e[0],n=e[1]||"8.8.8.8";
        try {
          const e="https://dns.google/resolve?name="+encodeURIComponent(t);
          return fetch(e).then(e=>e.ok?e.json():"nslookup: failed to query DNS").then(e=> {
            let r=[];
            if(r.push("Server:\t\t"+n),r.push("Address:\t"+n+"#53"),r.push(""),r.push("Non-authoritative answer:"),e.Answer)for(const n of e.Answer)r.push("Name:\t"+t),r.push("Address:\t"+n.data);
            else r.push("*** "+t+" not found");
            return r.join("\n")
          }).catch(e=>"nslookup: error: "+e.message)
        }catch(e) {
          return"nslookup: error: "+e.message
        }
      }),s.register("let",function(e) {
        if(0===e.length)return f("let");
        const t=e.join(" ");
        try {
          const e=Function('"use strict"; return ('+t+")")();
          return void 0!==e?String(e):""
        }catch(e) {
          return"let: "+e.message
        }
      }),s.register("expr",function(e) {
        if(0===e.length)return f("expr");
        const t=e.join(" ");
        try {
          const e=Function('"use strict"; return ('+t+")")();
          return String(e)
        }catch(e) {
          return"expr: "+e.message
        }
      }),s.register("sh",function(a){return runShellCmd("sh",a)}),s.register("bash",function(a){return runShellCmd("bash",a)}),s.register("linux64",function(e) {
        return 0===e.length?f("linux64"):b(e.join(" "))
      }),s.register("exec",function(a){
        if(a.length===0)return f("exec");
        var a0=a[0],rest=a.slice(1),login=false;
        if(a0==="-l"||a0==="--login"){login=true;if(rest.length===0)return f("exec");a0=rest[0];rest=rest.slice(1);}
        if(a0==="sh"||a0==="bash"){
          var keep=["PATH","HOME","USER","SHELL","PWD","OLDPWD","TERM","SHLVL","LANG","HOSTNAME","LOGNAME"],base={};
          for(var i=0;i<keep.length;i++)if(e.env[keep[i]]!==undefined)base[keep[i]]=e.env[keep[i]];
          base.PWD=e.cwd;base.SHLVL=String((parseInt(e.env.SHLVL||"1",10)||1));
          e.vars={};e.env=base;e.oldpwd=e.cwd;
          if(login){try{return b("source /home/.profile").then(function(){return a0+": exec: shell replaced (login)"})}catch(x){return a0+": exec: shell replaced (login)"}}
          return a0+": exec: shell replaced";
        }
        return b(a.join(" "));
      }),s.register("eval",function(e) {
        return 0===e.length?f("eval"):b(e.join(" "))
      }),s.register("jsc",function(e) {
        if(0===e.length)return"usage: jsc <file.js|js-code>";
        const t=a(e[0]);
        const isFile="undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(t);
        if(isFile){const src=webfs.read(t)||"";return executeJsSandbox(src,e.slice(1),"jsc");}
        return executeJsSandbox(e.join(" "),[],"jsc");
      }),s.register("source",function(e) {
        if(0===e.length)return f("source");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"source: "+t+": No such file";
        if(!webfs.fileExist(t))return d("source",t);
        if(webfs.isDir(t))return"source: "+t+": Is a directory";
        const __src=(webfs.read(t)||""),__fl=(__src.split("\n")[0]||"").trim();
        if(/\.js$/.test(t)||/^#!\s*\S*(js|node|javascript)/.test(__fl))return executeJsScript(e[0],t,__src,e.slice(1));
        const lines=__src.split("\n");
        let p=Promise.resolve(""),outs=[];
        for(const ln of lines) {
          const s=ln.trim();
          if(!s||s.startsWith("#")||s.startsWith("#!"))continue;
          p=p.then(()=>b(s).then(o=>{
            if(o&&""!==o)outs.push(String(o));
            return""
          }).catch(()=>""))
        }
        return p.then(()=>outs.join("\n"))
      }),s.register(".",function(e) {
        if(0===e.length)return f(".");
        const t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return t+": No such file";
        if(!webfs.fileExist(t))return d(".",t);
        if(webfs.isDir(t))return t+": Is a directory";
        const __src=(webfs.read(t)||""),__fl=(__src.split("\n")[0]||"").trim();
        if(/\.js$/.test(t)||/^#!\s*\S*(js|node|javascript)/.test(__fl))return executeJsScript(".",t,__src,e.slice(1));
        const lines=__src.split("\n");
        let p=Promise.resolve(""),outs=[];
        for(const ln of lines) {
          const s=ln.trim();
          if(!s||s.startsWith("#")||s.startsWith("#!"))continue;
          p=p.then(()=>b(s).then(o=>{
            if(o&&""!==o)outs.push(String(o));
            return""
          }).catch(()=>""))
        }
        return p.then(()=>outs.join("\n"))
      }),s.register("which",function(t) {
        if(0===t.length)return f("which");
        const out=[];
        for(const c of t) {
          if(BUILTINS.includes(c)) {
            out.push(c+": shell builtin");
            continue
          }
          const p=whichPath(c);
          out.push(p||c+": not found")
        }return out.join("\n")
      }),s.register("printenv",function(t) {
        if(t.length) {
          const out=[];
          for(const k of t)out.push(e.env[k]||"");
          return out.join("\n")
        }return Object.keys(e.env).sort().map(function(k) {
          return k+"="+e.env[k]
        }).join("\n")
      }),s.register("passwd",function(t) {
  if(0===t.length)return"passwd: missing operand\nUsage: passwd <new-password>";
  var pw=t[0],hash=passHash(pw);
  setPassHash(hash);
  try {
    var p="/etc/passwd",content=webfs.read(p)||"",lines=content.split("\n"),out=[],found=false;
    for(var i=0;i<lines.length;i++) {
      if(lines[i].indexOf("root:")===0){var parts=lines[i].split(":");parts[1]=hash;out.push(parts.join(":"));found=true}
      else out.push(lines[i]);
    }
    if(!found)out.unshift("root:"+hash+":0:0:root:/root:/bin/bash");
    webfs.write(p,out.join("\n"));
    return"passwd: password updated for root";
  }catch(e) {
    return"passwd: error: "+e.message
  }
}),s.register("{",function(e) {
        return b(e.join(" "))
      }),s.register("}",function() {
        return""
      });
      const BUILTINS=["cd","export","alias","unalias","set","unset","type","source",".","exit","shift","local","readonly","declare","typeset","let","eval","test","true","false","pwd","echo","printf","history","help","clear","read","exec","hash","jobs","fg","bg","wait","logout","ulimit","umask","times","trap","return","break","continue","command","builtin"];
      const whichPath=function(t) {
        try {
          const dirs=(e.env.PATH||"/bin").split(":");
          for(let i=0;i<dirs.length;i++) {
            const p=a(dirs[i]+"/"+t);
            if(webfs.fileExist(p))return p
          }
        }catch(e) {}
        return""
      };
      const resolveCommand=function(t) {
        try {
          if(t.includes("/")) {
            const p=a(t);
            return webfs.fileExist(p)?(webfs.read(p)||"").trim():""
          }
          const dirs=(e.env.PATH||"/bin").split(":");
          for(let i=0;i<dirs.length;i++) {
            const p=a(dirs[i]+"/"+t);
            if(webfs.fileExist(p))return(webfs.read(p)||"").trim()
          }
        }catch(e) {}
        return""
      };
      const resolveCommandPath=function(t) {
        try {
          if(t.includes("/")) {
            const p=a(t);
            return webfs.fileExist(p)?p:""
          }
          const dirs=(e.env.PATH||"/bin").split(":");
          for(let i=0;i<dirs.length;i++) {
            const p=a(dirs[i]+"/"+t);
            if(webfs.fileExist(p))return p
          }
        }catch(e) {}
        return""
      };
      const n=s.execute.bind(s);
      /* ===== v2.3 可执行文件支持：/bin、/usr/bin 中的 JS / Shell 源码直接运行 ===== */
      const __modCache={};
      const __jsRequire=function(name) {
        let base=name;
        if(!/\.js$/.test(base))base+=".js";
        const candidates=["/usr/lib/"+base,"/lib/"+base,"/usr/local/lib/"+base];
        let found="";
        for(let i=0;i<candidates.length;i++) {
          try{if(webfs.fileExist(candidates[i])){found=candidates[i];break}}catch(x){}
        }
        if(!found)throw new Error("Cannot find module '"+name+"'");
        if(__modCache[found])return __modCache[found].exports;
        let s2="";
        try{s2=(webfs.read(found)||"").replace(/^#![^\n]*/,"")}catch(x){}
        const m={exports:{}};
        __modCache[found]=m;
        const fn=new Function("module","exports","require",s2);
        fn(m,m.exports,__jsRequire);
        return m.exports;
      };
      const isShellScript=function(filePath,src) {
        const first=(src.split("\n")[0]||"").trim();
        if(/^#!\s*\S*(sh|bash)\s*$/.test(first))return true;
        if(/^#!\s*\/usr\/bin\/env\s+(ba)?sh\s*$/.test(first))return true;
        if(/\.sh$/.test(filePath)&&!/^#!\s*\S*(js|node|javascript)/.test(first))return true;
        return false;
      };
      const executeJsScript=function(cmdName,filePath,src,args) {
        __ioOut="";__ioErr="";
        try {
          const code=src.replace(/^#![^\n]*/,"");
          const module={exports:{}};
          const exportsObj=module.exports;
          const fn=new Function("wemlinux","system","stdlib","args","module","exports","require",code);
          fn(window.wemlinux,window.wemlinux.system,window.wemlinux.stdlib,args,module,exportsObj,__jsRequire);
          const m=module.exports;
          const handler=(typeof m==="function")?m:(m&&typeof m.main==="function"?m.main:null);
          if(typeof handler!=="function")return Promise.resolve(__ioOut+(__ioErr?"\n"+__ioErr:""));
          const ctx={wemlinux:window.wemlinux,system:window.wemlinux.system,stdlib:window.wemlinux.stdlib,cmd:cmdName,file:filePath,args:args};
          try {
            const ret=handler(args,ctx);
            return Promise.resolve(ret).then(function(out) {
              let s="";
              if(__ioOut)s+=__ioOut;
              if(out!=null&&String(out)!=="") {
                if(s&&!/\n$/.test(s))s+="\n";
                s+=String(out);
              }
              if(__ioErr)s+=(s&&!/\n$/.test(s)?"\n":"")+__ioErr;
              __ioOut="";__ioErr="";
              return s;
            });
          }catch(err) {
            __ioOut="";__ioErr="";
            return Promise.resolve("sh: "+cmdName+": error: "+(err&&err.message||err));
          }
        }catch(err) {
          return Promise.resolve("sh: "+cmdName+": error: "+(err&&err.message||err));
        }
      };
      const __domBlock={document:void 0,window:void 0,self:void 0,globalThis:void 0,top:void 0,parent:void 0,frames:void 0,navigator:void 0,location:void 0,localStorage:void 0,sessionStorage:void 0,history:void 0,screen:void 0,alert:void 0,prompt:void 0,confirm:void 0,indexedDB:void 0,WebSocket:void 0,Worker:void 0,XMLHttpRequest:void 0,fetch:void 0,Document:void 0,Element:void 0,HTMLElement:void 0,Node:void 0,Event:void 0,Image:void 0,Audio:void 0,DOMParser:void 0,MutationObserver:void 0,getComputedStyle:void 0,requestAnimationFrame:void 0,addEventListener:void 0,removeEventListener:void 0,open:void 0,close:void 0,print:void 0,scrollTo:void 0,focus:void 0,blur:void 0,postMessage:void 0};
      const executeJsSandbox=function(code,args,cmdName){
        __ioOut="";__ioErr="";
        try{
          const src=String(code==null?"":code).replace(/^#![^\n]*/,"");
          const module={exports:{}};
          const exportsObj=module.exports;
          const fn=new Function("wemlinux","system","stdlib","args","module","exports","require","__dom",
            "with(__dom){ (function(){\n"+src+"\n}).call(module); }");
          fn(window.wemlinux,window.wemlinux.system,window.wemlinux.stdlib,args,module,exportsObj,__jsRequire,__domBlock);
          const handler=(typeof module.exports==="function")?module.exports:(module.exports&&typeof module.exports.main==="function"?module.exports.main:null);
          if(typeof handler!=="function"){
            try{
              const ef=new Function("__dom","wemlinux","system","stdlib","args","module","exports","require",
                "with(__dom){ return (function(){\nreturn ("+src+");\n}).call(module); }");
              const rv=ef(__domBlock,window.wemlinux,window.wemlinux.system,window.wemlinux.stdlib,args,module,exportsObj,__jsRequire);
              return Promise.resolve(rv).then(function(out){
                let z="";
                if(__ioOut)z+=__ioOut;
                if(out!=null&&String(out)!==""){if(z&&!/\n$/.test(z))z+="\n";z+=String(out);}
                if(__ioErr)z+=(z&&!/\n$/.test(z)?"\n":"")+__ioErr;
                __ioOut="";__ioErr="";
                return z;
              });
            }catch(err){__ioOut="";__ioErr="";return Promise.resolve(__ioOut||"");}
          }
          const ctx={wemlinux:window.wemlinux,system:window.wemlinux.system,stdlib:window.wemlinux.stdlib,cmd:cmdName,file:"",args:args,sandbox:true};
          try{
            const ret=handler(args,ctx);
            return Promise.resolve(ret).then(function(out){
              let z="";
              if(__ioOut)z+=__ioOut;
              if(out!=null&&String(out)!==""){if(z&&!/\n$/.test(z))z+="\n";z+=String(out);}
              if(__ioErr)z+=(z&&!/\n$/.test(z)?"\n":"")+__ioErr;
              __ioOut="";__ioErr="";
              return z;
            });
          }catch(err){__ioOut="";__ioErr="";return Promise.resolve("sh: "+cmdName+": error: "+(err&&err.message||err));}
        }catch(err){return Promise.resolve("sh: "+cmdName+": error: "+(err&&err.message||err));}
      };
      const executeShellScript=async function(cmdName,filePath,src,args) {
        let body=src.replace(/^#![^\n]*\n?/,"");
        // 参数替换：$1..$n / ${1}..${n}（含引号内的 $1，不做分词）
        body=body.replace(/\$(\d+)/g,function(m,d){return args[+d-1]!==undefined?String(args[+d-1]):m});
        body=body.replace(/\$\{(\d+)\}/g,function(m,d){return args[+d-1]!==undefined?String(args[+d-1]):m});
        // 命令替换预处理：$(cmd) 在脚本内提前求值（b() 的引号占位符会遮蔽 $(...)）
        const matchCmd=String(body).match(/\$\(([^)]*)\)/g);
        if(matchCmd&&matchCmd.length) {
          for(let i=0;i<matchCmd.length;i++) {
            const cm=matchCmd[i];
            try {
              const val=await b(cm.slice(2,-1));
              body=body.split(cm).join(val||"");
            }catch(x) { body=body.split(cm).join(""); }
          }
        }
        const saved={};
        for(let i=0;i<args.length;i++) {
          saved["$"+(i+1)]=e.vars["$"+(i+1)];
          e.vars["$"+(i+1)]=args[i];
        }
        return Promise.resolve(x(body)).then(function(out) {
          for(let i=0;i<args.length;i++) {
            if(saved["$"+(i+1)]!==undefined)e.vars["$"+(i+1)]=saved["$"+(i+1)];
            else delete e.vars["$"+(i+1)];
          }
          return out;
        });
      };
      const executeCommandFile=function(cmdName,filePath,args) {
        let src="";
        try{src=webfs.read(filePath)||""}catch(err){}
        if(!src.trim())return Promise.resolve("");
        try {
          if(isShellScript(filePath,src))return executeShellScript(cmdName,filePath,src,args);
          return executeJsScript(cmdName,filePath,src,args);
        }catch(err) {
          return Promise.resolve("sh: "+cmdName+": error: "+(err&&err.message||err));
        }
      };
      s.execute=function(t,r) {
        if(this.has(t)&&BUILTINS.includes(t))return n(t,r);
        if(e.functions&&e.functions[t]) {
          const n=e.functions[t];
          for(let t=0;
          t<r.length;
          t++)e.vars["$"+(t+1)]=r[t];
          return x(n)
        }
        if(this.has(t))return n(t,r);
        const inner=resolveCommand(t);
        if(inner&&this.has(inner)) {
          try {
            const res=this.getHandler(inner)(r);
            return res&&"function"==typeof res.then?res:Promise.resolve(res||"")
          }catch(err) {
            return Promise.resolve("sh: "+t+": error: "+err.message)
          }
        }
        const fpath=resolveCommandPath(t);
        if(fpath)return executeCommandFile(t,fpath,r);
        return Promise.resolve("sh: "+t+": command not found")
      };
      const installBuiltins=function() {
        try {
          const reg=window.commandRouter&&window.commandRouter.registered||[];
          for(let i=0;i<reg.length;i++) {
            const c=reg[i];
            if(!c||BUILTINS.includes(c))continue;
            webfs.write("/bin/"+c,c)
          }
        }catch(e) {}
      };
      window.commandRouter=s,window.registerCommand=window.registerCommand||function(e,t){return s&&"function"==typeof s.register?(s.register(e,t),!0):!1};
      installBuiltins();
      setTimeout(function() {
        (async function() {
          try {
            await webfs.load()
          }catch(e) {}
          try {
            if(webfs.fileExist("/home/.profile"))await b("source /home/.profile")
          }catch(e) {}
          try {
            if(webfs.fileExist("/home/.bashrc"))await b("source /home/.bashrc")
          }catch(e) {}
        })()
      },0)
    })(),setTimeout(E,200)
  }"loading"===document.readyState?document.addEventListener("DOMContentLoaded",O):O(),window.executeShellCommand=S,window.handleCommand=S,window._state=e,window.safeResolvePath=a;
      /* ================= wemlinux v2.3 全局对象 / system / stdlib ================= */
      /* ---- 虚拟进程核心：与 ulimit 联动，外部可经 __sys/__stdlib 操作 ---- */
function enterSubShell(shellName,isLogin){
  if(procCount()>=e.ulimit.soft)return Promise.resolve(shellName+": fork: retry: Resource temporarily unavailable");
  var pid=allocPid(),parent={cwd:e.cwd,oldpwd:e.oldpwd,vars:e.vars,env:e.env};
  var proc={pid:pid,name:shellName,status:"running",active:true};e.ulimit.processes.push(proc);
  e.vars=Object.assign({},parent.vars);
  e.env=Object.assign({},parent.env);
  e.oldpwd=e.cwd;
  var promptStr=shellName+(isLogin?" (login)":"")+"-5.2$ ",buf="";
  return (async function(){
    if(isLogin){try{await b("source /home/.profile")}catch(x){}}
    while(true){
      var line=null;try{line=prompt(promptStr)}catch(x){}
      if(line===null)break;
      line=line.trim();
      if(line==="exit"||line==="logout")break;
      if(line==="")continue;
      try{var out=await b(line);if(out)buf+=(buf?"\n":"")+out}catch(x){buf+=(buf?"\n":"")+("sh: error: "+x.message)}
    }
    setProcStatus(proc,"exited");
    e.cwd=parent.cwd;e.oldpwd=parent.oldpwd;e.vars=parent.vars;e.env=parent.env;
    return buf;
  })();
}
function runShellFile(shellName,args){
  if(args.length===0)return"";
  var t=a(args[0]);
  if("undefined"==typeof webfs||!webfs.read)return shellName+": "+t+": No such file";
  if(!webfs.fileExist(t))return d(shellName,t);
  if(webfs.isDir(t))return shellName+": "+t+": Is a directory";
  try{
    for(var n=(webfs.read(t)||"").split("\n"),r=[],i=0;i<n.length;i++){
      var s=n[i].trim();
      if(""!==s&&!s.startsWith("#")&&!s.startsWith("#!")){
        var o=s.indexOf(" #");
        if(-1!==o){var c=s.substring(0,o).trim();""!==c&&r.push(c)}else r.push(s)
      }
    }
    var l=r.join("\n");
    return""===l?"":b(l)
  }catch(x){return shellName+": "+t+": error - "+x.message}
}
function runShellCmd(shellName,args){
  if(args.length===0)return enterSubShell(shellName,false);
  var a0=args[0],rest=args.slice(1);
  if(a0==="-l"||a0==="--login"){
    if(rest.length===0)return enterSubShell(shellName,true);
    if(rest[0]==="-c"&&rest.length>1){try{b("source /home/.profile")}catch(x){}return b(rest.slice(1).join(" "));}
    return runShellFile(shellName,rest);
  }
  if(a0==="-c"&&rest.length>0)return b(rest.join(" "));
  return runShellFile(shellName,args);
}
            function allocPid(){return String((parseInt(e.pid,10)||100)+e.ulimit.processes.length+1)}
      function procCount(){var c=0;for(var i=0;i<e.ulimit.processes.length;i++)if(e.ulimit.processes[i].active)c++;return c}
      function setProcStatus(p,st){p.status=st;p.active=(st!=="exited"&&st!=="zombie")}
      function signalNum(sig){
  sig=String(sig||"").toUpperCase();
  if(sig.indexOf("SIG")===0)sig=sig.slice(3);
  if(/^\d+$/.test(sig))return parseInt(sig,10);
  var m={HUP:1,INT:2,QUIT:3,ILL:4,TRAP:5,ABRT:6,BUS:7,FPE:8,KILL:9,USR1:10,SEGV:11,USR2:12,PIPE:13,ALRM:14,TERM:15,CHLD:17,CONT:18,STOP:19,TSTP:20,TTIN:21,TTOU:22,WINCH:28};
  return m[sig]||0;
}
function sigName(num){
  num=Number(num)||0;
  var m={1:"HUP",2:"INT",3:"QUIT",4:"ILL",5:"TRAP",6:"ABRT",7:"BUS",8:"FPE",9:"KILL",10:"USR1",11:"SEGV",12:"USR2",13:"PIPE",14:"ALRM",15:"TERM",16:"STKFLT",17:"CHLD",18:"CONT",19:"STOP",20:"TSTP",21:"TTIN",22:"TTOU",23:"URG",24:"XCPU",25:"XFSZ",26:"VTALRM",27:"PROF",28:"WINCH"};
  return m[num]||("SIG"+num);
}
async function emitSig(sig){
  sig=String(sig||"").toUpperCase();
  if(sig.indexOf("SIG")!==0)sig="SIG"+sig;
  e.signals=e.signals||{};e.traps=e.traps||{};
  var out="";
  (e.signals[sig]||[]).forEach(function(fn){try{var r=fn&&fn(sig);if(typeof r==="string"&&r)out+=(out?"\n":"")+r}catch(x){}});
  var tn=sig.slice(3),tc=e.traps[tn]||e.traps[sig];
  if(tc){try{var r2=await b(tc);if(r2)out+=(out?"\n":"")+r2}catch(x){}}
  e.lastExitCode=128+(signalNum(sig)||0);
  return out;
}
window.emitSig=emitSig;function oomKill(){
  var lim=e.oomLimit||1048576,killed=[];
  for(var i=0;i<e.ulimit.processes.length;i++){
    var p=e.ulimit.processes[i];
    if(p.active&&(p.mem||0)>lim){
      setProcStatus(p,"exited");p.exitCode=137;killed.push(p.pid);
    }
  }
  return killed;
}
window.oomKill=oomKill;
      function procSpawn(name,fn){
        if(procCount()>=e.ulimit.soft)return{ok:false,pid:null,error:"resource temporarily unavailable",limit:e.ulimit.soft};
        var pid=allocPid(),p={pid:pid,name:name||"proc",status:"running",active:true,cwd:e.cwd,started:Date.now(),exitCode:0,mem:0};
        e.ulimit.processes.push(p);
        if(typeof fn==="function"){
          try{
            var r=fn(p);
            if(r&&typeof r.then==="function"){r.then(function(){setProcStatus(p,"exited")}).catch(function(){setProcStatus(p,"exited");p.exitCode=1})}
            else setProcStatus(p,"exited");
          }catch(x){setProcStatus(p,"exited");p.exitCode=1}
        }
        return{ok:true,pid:pid,proc:p};
      }
      function procKill(pid){
        pid=String(pid);
        for(var i=0;i<e.ulimit.processes.length;i++)if(String(e.ulimit.processes[i].pid)===pid){if(e.ulimit.processes[i].active){setProcStatus(e.ulimit.processes[i],"exited");return true}return false}
        return false;
      }
      function bgStart(cmdStr){
        if(procCount()>=e.ulimit.soft)return{ok:false,pid:null,error:"resource temporarily unavailable",limit:e.ulimit.soft};
        var pid=allocPid(),nm=String(cmdStr||"").trim().split(/\s+/)[0]||"job",p={pid:pid,name:nm,status:"running",active:true,cwd:e.cwd,started:Date.now(),exitCode:0,mem:0};
        e.ulimit.processes.push(p);
        var pr=b(String(cmdStr||"").trim()).then(function(out){setProcStatus(p,"exited");p.output=out;return out}).catch(function(x){setProcStatus(p,"exited");p.exitCode=1;return"shell: "+x.message});
        e.backgroundJobs=e.backgroundJobs||[];
        var j={num:e.backgroundJobs.length+1,pid:pid,proc:p,promise:pr,cmd:String(cmdStr||"").trim()};
        e.backgroundJobs.push(j);
        return{ok:true,pid:pid,proc:p,job:j};
      }
      function procList(){var o=[];for(var i=0;i<e.ulimit.processes.length;i++)if(e.ulimit.processes[i].active)o.push(e.ulimit.processes[i]);return o}
      function procSetLimit(soft,hard){
        if(soft!=null){if(hard!=null&&soft>hard)return false;e.ulimit.soft=soft|0}
        if(hard!=null){if(soft!=null&&hard<soft)return false;e.ulimit.hard=hard|0}
        return true;
      }

      var __ioOut="",__ioErr="",__outHook=null,__errHook=null;
      var __sys={
        version:"2.3",
        /* ---- I/O 流：外部命令的输出/输入通道 ---- */
        stdin:{
          read:function(){try{return webfs.read("/tmp/.pipe")||""}catch(e){return""}},
          clear:function(){try{webfs.delFile("/tmp/.pipe")}catch(e){}}
        },
        stdout:{
          write:function(t){__ioOut+=String(t==null?"":t);return this},
          writeln:function(t){__ioOut+=String(t==null?"":t)+"\n";return this},
          buffer:function(){return __ioOut},
          reset:function(){__ioOut="";return this},
          set:function(fn){__outHook=typeof fn==="function"?fn:null;return this}
        },
        stderr:{
          write:function(t){__ioErr+=String(t==null?"":t);return this},
          writeln:function(t){__ioErr+=String(t==null?"":t)+"\n";return this},
          buffer:function(){return __ioErr},
          reset:function(){__ioErr="";return this},
          set:function(fn){__errHook=typeof fn==="function"?fn:null;return this}
        },
        /* ---- 输出合并：stdout + 返回值 + stderr，命令结束时调用 ---- */
        flush:function(ret){
          var s="";
          if(__ioOut)s+=(__outHook?__outHook(__ioOut):__ioOut);
          if(ret!=null&&String(ret)!=="")s+=(s?"\n":"")+String(ret);
          if(__ioErr)s+=(s?"\n":"")+(__errHook?__errHook(__ioErr):__ioErr);
          __ioOut="";__ioErr="";
          return s;
        },
        /* ---- 环境变量 ---- */
        setenv:function(name,value){
          if(!name)return false;
          e.env[name]=String(value==null?"":value);
          if(!e.exported.includes(name))e.exported.push(name);
          return true;
        },
        getenv:function(name){return e.env[name]!==undefined?e.env[name]:null},
        env:function(){return Object.assign({},e.env)},
        unsetenv:function(name){delete e.env[name];return true},
        /* ---- 工作目录 ---- */
        cwd:function(){return e.cwd},
        chdir:function(p){
          var np=a(p);
          try{if(!webfs.isDir(np))return false}catch(x){return false}
          e.oldpwd=e.cwd;e.cwd=np;e.env.OLDPWD=e.oldpwd;e.env.PWD=np;
          return true;
        },
        /* ---- 参数解析：支持子命令 subcommand / flags / options ---- */
        getargs:function(args,spec){
          args=args||[];spec=spec||{};
          var flags=spec.flags||[],opts=spec.options||[],subs=spec.subcommands||null;
          var res={subcommand:null,positionals:[],flags:{},options:{},raw:args.slice()};
          var i=0,first=true;
          while(i<args.length){
            var x=args[i];
            if(x==="--"){res.positionals=res.positionals.concat(args.slice(i+1));break}
            if(x.indexOf("--")===0&&x.length>2){
              var k=x.slice(2),eq=k.indexOf("=");
              if(eq>-1){res.options[k.slice(0,eq)]=k.slice(eq+1);i++;continue}
              if(opts.indexOf(k)>-1){res.options[k]=args[i+1]!==undefined?args[i+1]:true;i+=2;continue}
              if(subs===null&&args[i+1]!==undefined&&args[i+1].indexOf("-")!==0){res.options[k]=args[i+1];i+=2;continue}
              res.flags[k]=true;i++;continue;
            }
            if(x.indexOf("-")===0&&x.length>1&&!/^-\d/.test(x)){
              var consumed=false;
              for(var j=1;j<x.length;j++){
                var ch=x[j];
                if(opts.indexOf(ch)>-1){res.options[ch]=args[i+1]!==undefined?args[i+1]:true;consumed=true;i+=2;break}
                res.flags[ch]=true;
              }
              if(!consumed&&subs===null&&x.length===2&&args[i+1]!==undefined&&args[i+1].indexOf("-")!==0){
                res.options[x.charAt(1)]=args[i+1];i+=2;continue;
              }
              if(!consumed)i++;
              continue;
            }
            if(first){
              if(subs){if(subs.indexOf(x)>-1)res.subcommand=x;else res.positionals.push(x)}
              else res.subcommand=x;
              first=false;
            }else res.positionals.push(x);
            i++;
          }
          return res;
        },
        /* ---- 异常捕获（同步 + 异步） ---- */
        catch_excp:function(fn){
          try{
            var v=fn();
            return v&&typeof v.then==="function"
              ?v.then(function(r){return{ok:true,value:r}},function(err){return{ok:false,error:err,msg:err&&err.message||String(err)}})
              :{ok:true,value:v};
          }catch(err){
            return{ok:false,error:err,msg:err&&err.message||String(err)};
          }
        },
        /* ---- 软链接 ---- */
        softlink:{
          create:function(target,linkPath){try{return webfs.symlink(target,linkPath)}catch(e){return false}},
          target:function(path){try{return webfs.readlink(path)||""}catch(e){return""}},
          isLink:function(path){try{return webfs.isLink(path)}catch(e){return false}},
          resolve:function(path){return webfs.read(path)||""}
        },
        /* ---- 进程/退出 ---- */
        pid:function(){return e.pid},
        signal:{
          on:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};(e.signals[sig]=e.signals[sig]||[]).push(fn);return true},
          off:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};var a=e.signals[sig]||[];if(fn){var i=a.indexOf(fn);if(i>-1)a.splice(i,1)}else delete e.signals[sig];return true},
          emit:function(sig){return emitSig(sig)},
          list:function(){e.signals=e.signals||{};return Object.keys(e.signals).slice()},
          traps:function(){e.traps=e.traps||{};return Object.keys(e.traps).slice()}
        },
        oom:{
          kill:function(){return oomKill()},
          limit:function(n){if(n!=null)e.oomLimit=n|0;return e.oomLimit||1048576},
          mem:function(pid){pid=String(pid);var l=procList();for(var i=0;i<l.length;i++)if(String(l[i].pid)===pid)return l[i].mem||0;return 0},
          setMem:function(pid,b){pid=String(pid);for(var i=0;i<e.ulimit.processes.length;i++)if(String(e.ulimit.processes[i].pid)===pid){e.ulimit.processes[i].mem=b|0;return true}return false}
        },
        exit:function(code){e.lastExitCode=code|0;return code|0},
        exitCode:function(){return e.lastExitCode},
        proc:{
          count:function(){return procCount()},
          spawn:function(name,fn){return procSpawn(name,fn)},
          kill:function(pid){return procKill(pid)},
          list:function(){return procList()},
          get:function(pid){pid=String(pid);var l=procList();for(var i=0;i<l.length;i++)if(String(l[i].pid)===pid)return l[i];return null},
          limits:function(){return{soft:e.ulimit.soft,hard:e.ulimit.hard}},
          setLimit:function(soft,hard){return procSetLimit(soft,hard)}
        },
        /* ---- 命令 ---- */
        which:function(cmd){
          try{
            const dirs=(e.env.PATH||"/bin").split(":");
            for(let i=0;i<dirs.length;i++){const p=a(dirs[i]+"/"+cmd);if(webfs.fileExist(p))return p}
          }catch(x){}
          return"";
        },
        exec:function(cmd){return b(cmd)},
        register:function(name,handler){return s.register(name,handler),true},
        sleep:function(ms){return new Promise(function(r){setTimeout(r,ms)})}
      };
      /* 标准库：专供外部命令开发，精简但覆盖全链路 */
      var __stdlib={
        fs:{
          read:function(p){try{return webfs.read(p)||""}catch(e){return null}},
          write:function(p,c){try{return webfs.write(p,c)}catch(e){return false}},
          append:function(p,c){try{var o=webfs.fileExist(p)?(webfs.read(p)||""):"";return webfs.write(p,o+c)}catch(e){return false}},
          mkdir:function(p){try{return webfs.mkdir(p)}catch(e){return false}},
          rm:function(p){try{return webfs.delFile(p)}catch(e){return false}},
          ls:function(p){try{return webfs.getFileList(p)||[]}catch(e){return[]}},
          exists:function(p){try{return webfs.fileExist(p)}catch(e){return false}},
          isDir:function(p){try{return webfs.isDir(p)}catch(e){return false}},
          isFile:function(p){try{return webfs.fileExist(p)&&!webfs.isDir(p)}catch(e){return false}},
          stat:function(p){try{return webfs.stat(p)}catch(e){return null}},
          chmod:function(p,m){try{return webfs.chmod(p,m)}catch(e){return false}},
          size:function(p){try{return webfs.getFileSize(p)||0}catch(e){return 0}},
          rename:function(a2,b2){try{return webfs.rename(a2,b2)}catch(e){return false}},
          symlink:function(t,p){try{return webfs.symlink(t,p)}catch(e){return false}},
          readlink:function(p){try{return webfs.readlink(p)}catch(e){return""}},
          isLink:function(p){try{return webfs.isLink(p)}catch(e){return false}}
        },
        path:{
          resolve:function(p){return a(p)},
          join:function(){var parts=Array.prototype.slice.call(arguments);return a(parts.join("/"))},
          basename:function(p){var s=String(p||"").replace(/\/+$/,"");return s?s.split("/").pop():"/"},
          dirname:function(p){var s=String(p||"").replace(/\/+$/,"");if(!s)return"/";var i=s.lastIndexOf("/");return i<=0?"/":s.slice(0,i)},
          extname:function(p){var b=String(p||"").split("/").pop()||"";var i=b.lastIndexOf(".");return i>0?b.slice(i):""},
          normalize:function(p){return a(p)}
        },
        io:{
          out:function(t){__ioOut+=String(t==null?"":t);return true},
          err:function(t){__ioErr+=String(t==null?"":t);return true},
          print:function(t){__ioOut+=String(t==null?"":t);return true},
          println:function(t){__ioOut+=String(t==null?"":t)+"\n";return true},
          readPipe:function(){try{return webfs.read("/tmp/.pipe")||""}catch(e){return""}},
          flush:function(ret){return __sys.flush(ret)}
        },
        sys:{
          env:function(){return __sys.env()},
          setenv:function(n,v){return __sys.setenv(n,v)},
          getenv:function(n){return __sys.getenv(n)},
          unsetenv:function(n){return __sys.unsetenv(n)},
          cwd:function(){return e.cwd},
          chdir:function(p){return __sys.chdir(p)},
          exit:function(c){return __sys.exit(c)},
          exitCode:function(){return e.lastExitCode},
          pid:function(){return e.pid},
          signal:{
            on:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};(e.signals[sig]=e.signals[sig]||[]).push(fn);return true},
            off:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};var a=e.signals[sig]||[];if(fn){var i=a.indexOf(fn);if(i>-1)a.splice(i,1)}else delete e.signals[sig];return true},
            emit:function(sig){return emitSig(sig)},
            list:function(){e.signals=e.signals||{};return Object.keys(e.signals).slice()},
            traps:function(){e.traps=e.traps||{};return Object.keys(e.traps).slice()}
          },
          which:function(c){return __sys.which(c)},
          exec:function(c){return b(c)},
          sleep:function(ms){return __sys.sleep(ms)}
        },
        proc:{
          register:function(n,h){return s.register(n,h),true},
          has:function(n){return s.has(n)},
          get:function(n){return s.getHandler(n)},
          list:function(){return s.registered.slice()},
          execute:function(n,args){return s.execute(n,args||[])},
          unregister:function(n){if(s.has(n)){delete s.handlers[n];var i=s.registered.indexOf(n);if(i>-1)s.registered.splice(i,1);return true}return false},
          spawn:function(name,fn){return procSpawn(name,fn)},
          kill:function(pid){return procKill(pid)},
          list:function(){return procList()},
          count:function(){return procCount()},
          get:function(pid){pid=String(pid);var l=procList();for(var i=0;i<l.length;i++)if(String(l[i].pid)===pid)return l[i];return null},
          limits:function(){return{soft:e.ulimit.soft,hard:e.ulimit.hard}},
          setLimit:function(soft,hard){return procSetLimit(soft,hard)},
          pid:function(){return e.pid},
          signal:{
            on:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};(e.signals[sig]=e.signals[sig]||[]).push(fn);return true},
            off:function(sig,fn){sig=String(sig).toUpperCase();if(sig.indexOf("SIG")!==0)sig="SIG"+sig;e.signals=e.signals||{};var a=e.signals[sig]||[];if(fn){var i=a.indexOf(fn);if(i>-1)a.splice(i,1)}else delete e.signals[sig];return true},
            emit:function(sig){return emitSig(sig)},
            list:function(){e.signals=e.signals||{};return Object.keys(e.signals).slice()},
            traps:function(){e.traps=e.traps||{};return Object.keys(e.traps).slice()}
          },
          setMem:function(pid,b){pid=String(pid);for(var i=0;i<e.ulimit.processes.length;i++)if(String(e.ulimit.processes[i].pid)===pid){e.ulimit.processes[i].mem=b|0;return true}return false},
          mem:function(pid){pid=String(pid);var l=procList();for(var i=0;i<l.length;i++)if(String(l[i].pid)===pid)return l[i].mem||0;return 0},
          oomKill:function(){return oomKill()},
          oomLimit:function(n){if(n!=null)e.oomLimit=n|0;return e.oomLimit||1048576}
        },
        utils:{
          esc:function(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")},
          quote:function(s){return '"'+String(s).replace(/"/g,'\\"')+'"'},
          isNum:function(s){return/^\d+$/.test(String(s))},
          formatSize:function(n){if(!n||n<=0)return"0B";var t=Math.floor(Math.log(n)/Math.log(1024));return parseFloat((n/Math.pow(1024,t)).toFixed(2))+["B","KB","MB","GB"][t]},
          pad:function(n,len){var s=String(n);while(s.length<(len||2))s="0"+s;return s},
          now:function(){return Date.now()},
          random:function(){return Math.random()}
        }
      };
      window.wemlinux={
        version:"2.4",
        author:"evo",
        name:"WemLinux",
        webfs:window.webfs,
        system:__sys,
        stdlib:__stdlib,
        shell:{
          execute:function(cmd){return b(cmd)},
          state:function(){return e},
          commandRouter:s,
          resolvePath:a
        }
      };
}();
