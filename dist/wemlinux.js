/* wemlinux 1.5 
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
   * 判断文件是否存在（兼容 wc.js）
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
   * 读取文件内容
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
    return true;
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
   * 退出回调
   * @returns {void}
   */
  function exit() {window.close();}

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
    write("/etc/motd", "Welcome to WemLinux - a lightweight Linux simulator powered by webfs\n");
    write("/etc/passwd", "root:x:0:0:root:/root:/system/bin/sh\nuser:x:1000:1000:user:/home/user:/system/bin/sh\n");
    write("/etc/hostname", "humminglinux\n");
    write("/home/user/README.txt", "Welcome to WemLinux!\nType 'help' to see available commands.\n");
    write("/tmp/.keep", "");
  }

  initDefaultTree();

  return {
    exists: exists,
    fileExist: fileExist,
    isDir: isDir,
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
    normalizePath: normalizePath
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
 * wemlinux v1.5.0
 * @author: Evo
 * @date: 2026-07-28
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
      PATH:"/system/bin:/system/xbin:/sbin:/vendor/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/system/bin/sh",USER:"root",HOSTNAME:"humminglinux"
    },vars: {
      
    },readonly:[],exported:[],aliases: {
      
    },history:[],permissions: {
      
    },ulimit: {
      soft:256,hard:256,processes:[]
    },jobs:[],backgroundJobs:[],lastOutput:"",lastExitCode:0,oldpwd:"/",dirStack:[],functions: {
      
    },loopDepth:0,breakLevel:0,continueLevel:0
  }),void 0!==window._state&&window._state?window._state.env||(window._state.env= {
    PATH:"/system/bin:/system/xbin:/sbin:/vendor/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/system/bin/sh",USER:"root",HOSTNAME:"humminglinux"
  }):window._state= {
    cwd:"/",pid:String(Math.floor(9e4*Math.random())+1e4),env: {
      PATH:"/system/bin:/system/xbin:/sbin:/vendor/bin",HOME:"/home",TERMINAL:"WemLinux",SHELL:"/system/bin/sh",USER:"root",HOSTNAME:"humminglinux"
    },vars: {
      
    },readonly:[],exported:[],aliases: {
      
    },history:[],permissions: {
      
    },ulimit: {
      soft:256,hard:256,processes:[]
    },jobs:[],backgroundJobs:[],lastOutput:"",lastExitCode:0,oldpwd:"/",dirStack:[],functions: {
      
    },loopDepth:0,breakLevel:0,continueLevel:0
  },window._state&&!window._state.readonly&&(window._state.readonly=[]),window._state&&!window._state.exported&&(window._state.exported=[]),window._state&&!window._state.aliases&&(window._state.aliases= {
    
  }),window._state&&!window._state.vars&&(window._state.vars= {
    
  }),window._state&&!window._state.permissions&&(window._state.permissions= {
    
  }),window._state&&!window._state.dirStack&&(window._state.dirStack=[]),window._state&&!window._state.functions&&(window._state.functions= {
    
  }),window._state&&!window._state.history&&(window._state.history=[]),window._state&&!window._state.ulimit&&(window._state.ulimit= {
    soft:256,hard:256,processes:[]
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
    const s=t.match(/\$\(([^)]*)\)/g);
    if(s)for(const e of s) {
      const t=y(e.slice(2,-1));
      n=n.replace(e,t||"")
    }return n
  }function y(e) {
    if(!e||""===e.trim())return"";
    let t="";
    return(async()=> {
      const n=await function(e) {
        return e&&""!==e.trim()?b(e.trim()):Promise.resolve("")
      }(e.trim());
      t=n
    })(),t
  }function x(t) {
    if(!t)return"";
    const n=t.split("\n");
    let r=[],i=!1,o="",c=[],a=!1,l=[],u="",f="",d=!1,h="",p=[],m=[],w=!1;
    for(const t of n) {
      const n=t.trim();
      if(!n||n.startsWith("#"))continue;
      if(n.match(/^[^\s{}();&|]+\s*\(\)\s*\{/)) {
        const e=n.match(/^([^\s{}();&|]+)\s*\(\)\s*\{/);
        if(e) {
          o=e[1],i=!0,c=[];
          const t=n.slice(e[0].length).trim();
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
        d=!0,h=n.slice(2).trim(),p=[],m=[],w=!1;
        continue
      }if(d) {
        if("then"===n)continue;
        if("else"===n) {
          w=!0;
          continue
        }if("fi"===n) {
          d=!1;
          const e=h.split(/\s+/);
          if(e.length>0) {
            const t=s.execute(e[0],e.slice(1));
            let n=""===t||null==t||"0"===t?p.join("\n"):m.join("\n");
            if(n) {
              const e=x(n);
              e&&r.push(e)
            }
          }continue
        }w?m.push(t):p.push(t);
        continue
      }if("while"===n||n.startsWith("while ")) {
        a=!0,f="while",u=n.slice(5).trim(),l=[];
        continue
      }if("for"===n||n.startsWith("for ")) {
        a=!0,f="for",u=n.slice(3).trim(),l=[];
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
              const t=u.split(/\s+/);
              if(0===t.length)break;
              const n=s.execute(t[0],t.slice(1));
              if(""!==n&&null!=n&&"0"!==n)break;
              const i=x(l.join("\n"));
              i&&r.push(i),e++
            }
          }else if("for"===f) {
            const t=u.indexOf("in"),n=u.indexOf("do");
            if(t>-1&&n>-1) {
              const i=u.slice(0,t).trim(),s=u.slice(t+2,n).trim().split(/\s+/);
              for(const t of s) {
                e.vars[i]=t;
                const n=x(l.join("\n"));
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
        b(n.slice(2,-1));
        continue
      }const y=b(n);
      if("function"==typeof y.then)return y.then(e=>(e&&""!==e&&r.push(e),r.join("\n")));
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
    const fnM=n.match(/^([^\s{}();&|]+)\s*\(\)\s*\{([\s\S]*?)\}\s*(.*)$/);
    if(fnM) {
      e.functions||(e.functions={});
      e.functions[fnM[1]]=fnM[2].trim();
      const rest=fnM[3].trim();
      if(rest)return b(rest.charAt(0)===";"?rest.slice(1).trim():rest);
      return Promise.resolve("function "+fnM[1]+" defined")
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
      const t=s.replace(/"[^"]*"|'[^']*'/g,function(m) {
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
    const o=function(e) {
      const t=e.split(/\|\|/).map(e=>e.trim());
      if(t.length>1)return {
        type:"or",parts:t
      };
      const n=e.split(/&&/).map(e=>e.trim());
      if(n.length>1)return {
        type:"and",parts:n
      };
      const r=e.split(/;/).map(e=>e.trim());
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
      let e="",t=!1,n=Promise.resolve();
      for(const r of o.parts)n=n.then(()=>t?e:b(q.restore(r)).then(n=>(""!==n&&null!=n&&(t=!0,e=n),e)));
      return n
    }if("and"===o.type) {
      let e=[],t=Promise.resolve();
      for(const n of o.parts)t=t.then(function() {
        return b(q.restore(n)).then(function(t) {
          return""!==t&&null!=t&&e.push(t),""
        }).catch(function(x) {
          return e.push("sh: "+x.message),""
        })
      });
      return t.then(function() {
        return e.join("\n")
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
    }return function(n,r) {
      const i=v((r&&r.cmd||n)).trim();
      if(!i)return Promise.resolve("");
      const o=i.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
      if(o) {
        const t=o[1];
        let n=o[2];
        return n=v(n),g(t)?(e.lastExitCode=1,Promise.resolve("sh: "+t+": readonly variable")):(e.vars[t]=n,e.lastExitCode=0,Promise.resolve(""))
      }const c=i.split(/\s+/);
      if(0===c.length)return Promise.resolve("");
      const l=c[0],u=c.slice(1).map(function(x) {
        return(x.startsWith('"')&&x.endsWith('"'))||(x.startsWith("'")&&x.endsWith("'"))?x.slice(1,-1):x
      });
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
    }(q.restore(o.cmd), function(e) {
      let t=e,n=!1,r=null;
      const i=t.match(/(>>)\s*(\S+)/);
      i&&(n=!0,r=i[2],t=t.replace(i[0],"").trim());
      const s=t.match(/(>)\s*(\S+)/);
      return s&&!n&&(r=s[2],t=t.replace(s[0],"").trim()), {
        cmd:t,append:n,outputFile:r
      }
    }(q.restore(o.cmd)))
  }async function S(e) {
    var n=e.trim();
    if(!n)return"";
    if(n.startsWith("#"))return"";
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
  }function E() {
    if(o)return;
    if(!t||!n)return void setTimeout(E,100);
    o=!0,t.innerHTML="";
    const e=document.createElement("div");
    e.textContent='WemLinux v26.1.5 - Type "help" for available commands',t.appendChild(e);
    const s=document.createElement("div");
    s.textContent="$ ",t.appendChild(s),t.scrollTop=t.scrollHeight,n.disabled=!1,n.focus(),n.addEventListener("keydown",async function(e) {
      if("Enter"===e.key) {
        const e=this.value;
        if(!e.trim())return void(this.value="");
        const n=document.createElement("div");
        n.textContent="$ "+e,t.appendChild(n);
        const s=await S(e);
        if(s&&""!==s) {
          const e=document.createElement("div");
          e.textContent=s,t.appendChild(e)
        }this.value="";
        const o=document.createElement("div");
        o.textContent="$ ",t.appendChild(o),t.scrollTop=t.scrollHeight,e.trim()&&(r.push(e.trim()),i=r.length)
      }"ArrowUp"===e.key&&(e.preventDefault(),r.length>0&&(i=Math.max(0,i-1),this.value=r[i]||"")),"ArrowDown"===e.key&&(e.preventDefault(),i<r.length-1?(i=Math.min(r.length-1,i+1),this.value=r[i]||""):(i=r.length,this.value=""))
    }),document.addEventListener("click",()=> {
      n.disabled||n.focus()
    })
  }function O() {
    (function() {
      if(s)return s;
      s=new c,s.register("cd",function(t) {
        if(t.length>1)return"cd: too many arguments\nTry 'cd --help' for more information.";
        let n=t[0]||"~";
        "~"===n&&(n=e.env.HOME||"/home"),"-"===n&&e.oldpwd&&(n=e.oldpwd);
        const r=a(n);
        return"undefined"!=typeof webfs&&webfs.isDir&&!webfs.isDir(r)?"cd: "+r+": No such file or directory":(e.oldpwd=e.cwd,e.cwd=r,"")
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
    ".": "同 source",
    "alias": "定义别名",
    "awk": "AWK 文本处理",
    "base64": "Base64 编解码",
    "bash": "运行 bash 脚本",
    "bc": "计算器",
    "bg": "后台任务",
    "break": "跳出循环",
    "case": "分支选择",
    "cat": "显示文件内容",
    "cd": "切换目录",
    "chmod": "修改权限",
    "chown": "修改所有者",
    "clad": "设备调试",
    "clear": "清屏",
    "command": "执行命令",
    "continue": "继续循环",
    "cp": "复制文件",
    "curl": "HTTP 请求",
    "cut": "按列裁剪文本",
    "date": "显示日期时间",
    "dd": "数据块复制",
    "declare": "声明变量",
    "df": "磁盘使用",
    "dir": "列出目录（同 ls）",
    "dirs": "目录栈",
    "dmesg": "内核日志",
    "do": "循环体",
    "done": "循环结束",
    "du": "统计目录占用",
    "echo": "输出文本",
    "ed": "行编辑器",
    "else": "否则分支",
    "env": "显示环境变量",
    "esac": "case 结束",
    "eval": "重新求值",
    "exec": "执行替换",
    "exit": "退出 shell",
    "export": "导出环境变量",
    "expr": "表达式求值",
    "false": "返回失败",
    "fg": "前台任务",
    "fi": "if 结束",
    "find": "查找文件",
    "for": "循环",
    "free": "内存使用",
    "function": "定义函数",
    "grep": "按模式搜索文本",
    "hash": "命令哈希",
    "head": "显示文件开头",
    "history": "命令历史",
    "hostname": "显示主机名",
    "id": "显示用户身份",
    "if": "条件分支",
    "ifconfig": "网络接口",
    "jobs": "任务列表",
    "kill": "终止进程",
    "killall": "按名终止进程",
    "last": "登录记录",
    "let": "算术运算",
    "linux64": "linux64 运行器",
    "ln": "创建链接",
    "local": "定义局部变量",
    "logout": "退出登录",
    "ls": "列出目录内容",
    "mkdir": "创建目录",
    "mount": "挂载信息",
    "mv": "移动/重命名文件",
    "netstat": "网络状态",
    "nice": "调整优先级",
    "nslookup": "DNS 查询",
    "ping": "网络连通测试",
    "popd": "弹出目录栈",
    "printf": "格式化输出",
    "ps": "进程列表",
    "pushd": "压入目录栈",
    "pwd": "显示当前目录",
    "read": "读取输入",
    "readonly": "标记只读变量",
    "reset": "重置终端",
    "return": "函数返回",
    "rm": "删除文件或目录",
    "rmdir": "删除空目录",
    "sed": "流编辑器",
    "sh": "运行 shell 脚本",
    "sha256sum": "计算 SHA-256 摘要",
    "sleep": "延时",
    "sort": "排序文本行",
    "source": "执行脚本文件",
    "stat": "显示文件状态",
    "su": "切换用户",
    "sudo": "提权执行",
    "tail": "显示文件末尾",
    "test": "条件测试",
    "then": "if 分支体",
    "time": "计时",
    "times": "显示累计时间",
    "top": "进程监视",
    "touch": "创建/更新时间戳",
    "tree": "树状显示目录",
    "true": "返回成功",
    "type": "显示命令类型",
    "typeset": "声明变量（同 declare）",
    "umask": "默认权限掩码",
    "umount": "卸载",
    "unalias": "删除别名",
    "uname": "显示系统信息",
    "uniq": "去重相邻行",
    "unset": "删除变量",
    "uptime": "运行时长",
    "w": "谁在登录",
    "wc": "统计行/词/字节数",
    "wget": "下载文件",
    "while": "条件循环",
    "who": "登录用户",
    "whoami": "显示当前用户",
    "yes": "重复输出"
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
      }),s.register("rm",function(e) {
        if(0===e.length)return f("rm");
        var t= {
          recursive:!1,force:!1
        },n=[];
        for(var r of e)if("-r"===r||"-R"===r)t.recursive=!0;
        else if("-f"===r)t.force=!0;
        else if("-rf"===r||"-fr"===r)t.recursive=!0,t.force=!0;
        else {
          if(r.startsWith("-"))return p("rm",r);
          n.push(r)
        }if(0===n.length)return f("rm");
        for(var i=[],s=0;
        s<n.length;
        s++) {
          var o=n[s],c=a(o),l="/"===c||"/data"===c||"/system"===c||"/vendor"===c||"/boot"===c||"/etc"===c||"/root"===c||"/bin"===c||"/dev"===c||"/sbin"===c||"/proc"===c||"/sys"===c||"/init"===c||"/apex"===c||"/product"===c||"/odm"===c;
          if(l&&window._sudoMode) {
            if("10086"!==prompt("Password required for rm "+o+":"))return window._sudoMode=!1,"su: Authentication failure";
            try {
              var u=webfs.getFileList(c)||[];
              Array.isArray(u)||(u=[]);
              for(var m=0;
              m<u.length;
              m++) {
                var g=u[m],v=c+"/"+g.name;
                if("directory"===g.type)(function e(t) {
                  var n=webfs.getFileList(t)||[];
                  Array.isArray(n)||(n=[]);
                  for(var r=0;
                  r<n.length;
                  r++) {
                    var i=t+"/"+n[r].name;
                    if("directory"===n[r].type)e(i);
                    else try {
                      webfs.delFile(i)
                    }catch(e) {
                      
                    }
                  }try {
                    webfs.delFile(t)
                  }catch(e) {
                    
                  }
                })(v);
                else try {
                  webfs.delFile(v)
                }catch(e) {
                  
                }
              }try {
                webfs.delFile(c)
              }catch(e) {
                
              }
            }catch(e) {
              
            }try {
              for(var y=["WemLinuxDB","TempRootDB"],x=0;
              x<y.length;
              x++)try {
                indexedDB.deleteDatabase(y[x])
              }catch(e) {
                
              }if("undefined"!=typeof localStorage)try {
                localStorage.clear()
              }catch(e) {
                
              }if("undefined"!=typeof sessionStorage)try {
                sessionStorage.clear()
              }catch(e) {
                
              }e&&(e.vars= {
                
              },e.readonly=[],e.exported=[],e.aliases= {
                
              },e.history=[],e.permissions= {
                
              },e.ulimit= {
                soft:256,hard:256,processes:[]
              },e.jobs=[],e.backgroundJobs=[],e.dirStack=[],e.functions= {
                
              })
            }catch(e) {
              
            }return window._sudoMode=!1,setTimeout(function() {
              "undefined"!=typeof webfs&&webfs.exit&&webfs.exit()
            },300),""
          }if(l)return"rm: it is dangerous to operate recursively on '"+o+"'";
          if("undefined"==typeof webfs||!webfs.delFile)return"rm: cannot remove '"+c+"': No such file or directory";
          if(!webfs.fileExist(c)) {
            if(t.force)continue;
            return d("rm",c)
          }if(webfs.isDir(c)&&!t.recursive)return h("rm",c);
          if(webfs.isDir(c)&&t.recursive) {
            w(c);
            try {
              webfs.delFile(c)
            }catch(e) {
              
            }t.force||i.push("rm: removed '"+c+"'")
          }else {
            try {
              webfs.delFile(c)
            }catch(e) {
              
            }t.force||i.push("rm: removed '"+c+"'")
          }
        }return i.join("\n")
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
      }),s.register("uname",function(e) {
        return 0===e.length?"Linux":"-a"===e[0]?"Linux "+(window._state&&window._state.env&&window._state.env.HOSTNAME||"linux")+" 5.10.198-android #1 SMP aarch64 GNU/Linux":"-s"===e[0]?"Linux":"-n"===e[0]?(window._state&&window._state.env&&window._state.env.HOSTNAME||"linux"):"-r"===e[0]?"5.10.198-android":"-m"===e[0]?"aarch64":"uname: invalid option '"+e[0]+"'"
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
        const t=e[0];
        return"root"!==t?"su: user "+t+" does not exist":""
      }),s.register("sudo",function(e) {
        if(0===e.length)return f("sudo");
        var t=e[0],n=e.slice(1);
        if(("rm"===t||"kill"===t||"killall"===t)&&n.some(function(e) {
          return"-rf"===e||"-r"===e||"-f"===e
        })) {
          window._sudoMode=!0;
          var r=b(t+(n.length>0?" "+n.join(" "):""));
          return window._sudoMode=!1,r
        }return"ls"===t||"cat"===t?"sudo: "+t+": command not found":""
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
        const n=[];
        for(const e of t)m(e)&&n.push(e);
        if(0===n.length)return f("kill");
        let r=[];
        for(const t of n) {
          if("1"===t||"2"===t)return"bash: kill: ("+t+") - Operation not permitted";
          var i=e.ulimit.processes.find(function(e) {
            return e.pid===t&&e.active
          });
          i?(i.active=!1,r.push("kill: signal sent to PID "+t)):r.push("bash: kill: ("+t+") - No such process")
        }return r.join("\n")
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
        let t=["PID   TTY      TIME     CMD"];
        t.push(e.pid+"   pts/0    00:00:01  bash");
        const n=e.ulimit.processes.filter(e=>e.active);
        for(const e of n.slice(0,5))t.push(e.pid+"   pts/0    00:00:00  "+e.name);
        return t.join("\n")
      }),s.register("top",function() {
        let t=["PID  USER     PR  NI  VIRT  RES  SHR  S  %CPU  %MEM  TIME+  COMMAND"];
        t.push(e.pid+"  root     20   0  12.8m 4.2m 3.8m  S   0.0   0.1  0:00.01  bash");
        const n=e.ulimit.processes.filter(e=>e.active);
        for(const e of n.slice(0,5))t.push(e.pid+"  root     20   0  8.6m  2.1m 1.8m  S   0.0   0.1  0:00.00  "+e.name);
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
        return s.has(n)?n+" is a shell builtin":e.aliases[n]?n+" is an alias for '"+e.aliases[n]+"'":e.functions&&e.functions[n]?n+" is a function":n+" is not found"
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
        if(t.startsWith("-e ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"
        }if(t.startsWith("-f ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)&&!webfs.isDir(e)?"":"1"
        }if(t.startsWith("-d ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.isDir&&webfs.isDir(e)?"":"1"
        }if(t.startsWith("-r ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"
        }if(t.startsWith("-w ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"
        }if(t.startsWith("-x ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)?"":"1"
        }if(t.startsWith("-s ")) {
          const e=l(t.slice(3).trim());
          return"undefined"!=typeof webfs&&webfs.fileExist&&webfs.fileExist(e)&&(webfs.getFileSize(e)||0)>0?"":"1"
        }if(t.startsWith("-z ")) {
          const e=t.slice(3).trim();
          return""===e||'""'===e||"''"===e?"":"1"
        }if(t.startsWith("-n ")) {
          const e=t.slice(3).trim();
          return""!==e&&'""'!==e&&"''"!==e?"":"1"
        }const n=t.match(/^(.+?)\s*=\s*(.+)$/);
        if(n)return n[1].trim()===n[2].trim()?"":"1";
        const r=t.match(/^(.+?)\s*!=\s*(.+)$/);
        if(r)return r[1].trim()!==r[2].trim()?"":"1";
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
        const t=e.ulimit.processes.filter(e=>e.active);
        return 0===t.length?"":t.map((e,t)=>"["+String(t+1)+"]  Running                 "+e.name).join("\n")
      }),s.register("bg",function() {
        const t=e.ulimit.processes.filter(e=>e.active);
        return 0===t.length?"":"[1] "+t[0].name+" &"
      }),s.register("fg",function() {
        const t=e.ulimit.processes.filter(e=>e.active);
        return 0===t.length?"":t[0].name+" (PID "+t[0].pid+")"
      }),s.register("logout",function() {
        return"undefined"!=typeof webfs&&webfs.exit&&webfs.exit(),""
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
        return new Promise(e=> {
          try {
            const t=indexedDB.deleteDatabase("WemLinuxDB");
            t.onsuccess=function() {
              e("clad: all IndexedDB data cleared")
            },t.onerror=function() {
              e("clad: failed to clear IndexedDB data")
            },t.onblocked=function() {
              e("clad: database blocked, close other tabs")
            }
          }catch(t) {
            e("clad: error: "+t.message)
          }
        })
      }),s.register("if",function(e) {
        const t=e.join(" "),n=t.indexOf("then"),r=t.indexOf("fi");
        if(-1===n||-1===r)return"if: syntax error";
        const i=t.slice(0,n).trim(),o=t.slice(n+4,r).trim(),c=i.split(/\s+/);
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
        const i=t.slice(0,n).trim(),o=t.slice(n+2,r).trim();
        let c=[],a=0;
        return new Promise(e=> {
          !function t() {
            if(a>=100)return void e(c.join("\n"));
            const n=i.split(/\s+/);
            if(0===n.length)return void e(c.join("\n"));
            const r=s.execute(n[0],n.slice(1));
            Promise.resolve(r).then(n=> {
              if(""===n||null==n||"0"===n)if(o) {
                const e=b(o);
                Promise.resolve(e).then(e=> {
                  e&&""!==e&&c.push(e),a++,setTimeout(t,50)
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
        const o=n.slice(0,r).trim(),c=n.slice(r+2,i).trim(),a=n.slice(i+2,s).trim(),l=c.split(/\s+/);
        let u=[],f=0;
        return new Promise(t=> {
          !function n() {
            if(f>=l.length)return void t(u.join("\n"));
            const r=l[f];
            if(e.vars[o]=r,a) {
              const e=b(a);
              Promise.resolve(e).then(e=> {
                e&&""!==e&&u.push(e),f++,setTimeout(n,50)
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
        const n=t[0],r=t.slice(1).join(" "),i=r.indexOf("{");
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
      }),s.register("sh",function(e) {
        if(0===e.length)return"";
        if("-c"===e[0]&&e.length>1)return b(e.slice(1).join(" "));
        var t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"sh: "+t+": No such file";
        if(!webfs.fileExist(t))return d("sh",t);
        if(webfs.isDir(t))return"sh: "+t+": Is a directory";
        try {
          for(var n=(webfs.read(t)||"").split("\n"),r=[],i=0;
          i<n.length;
          i++) {
            var s=n[i].trim();
            if(""!==s&&!s.startsWith("#")&&!s.startsWith("#!")) {
              var o=s.indexOf(" #");
              if(-1!==o) {
                var c=s.substring(0,o).trim();
                ""!==c&&r.push(c)
              }else r.push(s)
            }
          }var l=r.join("; ");
          return""===l?"":b(l)
        }catch(e) {
          return"sh: "+t+": error - "+e.message
        }
      }),s.register("bash",function(e) {
        if(0===e.length)return"";
        if("-c"===e[0]&&e.length>1)return b(e.slice(1).join(" "));
        var t=a(e[0]);
        if("undefined"==typeof webfs||!webfs.read)return"bash: "+t+": No such file";
        if(!webfs.fileExist(t))return d("bash",t);
        if(webfs.isDir(t))return"bash: "+t+": Is a directory";
        try {
          for(var n=(webfs.read(t)||"").split("\n"),r=[],i=0;
          i<n.length;
          i++) {
            var s=n[i].trim();
            if(""!==s&&!s.startsWith("#")&&!s.startsWith("#!")) {
              var o=s.indexOf(" #");
              if(-1!==o) {
                var c=s.substring(0,o).trim();
                ""!==c&&r.push(c)
              }else r.push(s)
            }
          }var l=r.join("\n");
          return""===l?"":b(l)
        }catch(e) {
          return"bash: "+t+": error - "+e.message
        }
      }),s.register("linux64",function(e) {
        return 0===e.length?f("linux64"):b(e.join(" "))
      }),s.register("exec",function(e) {
        return 0===e.length?f("exec"):b(e.join(" "))
      }),s.register("eval",function(e) {
        return 0===e.length?f("eval"):b(e.join(" "))
      }),s.register("source",function(e) {
        if(0===e.length)return f("source");
        const t=a(e[0]);
        return"undefined"!=typeof webfs&&webfs.read?webfs.fileExist(t)?webfs.isDir(t)?"source: "+t+": Is a directory":x(webfs.read(t)||""):d("source",t):"source: "+t+": No such file"
      }),s.register(".",function(e) {
        if(0===e.length)return f(".");
        const t=a(e[0]);
        return"undefined"!=typeof webfs&&webfs.read?webfs.fileExist(t)?webfs.isDir(t)?t+": Is a directory":x(webfs.read(t)||""):d(".",t):t+": No such file"
      }),s.register("{",function(e) {
        return b(e.join(" "))
      }),s.register("}",function() {
        return""
      });
      const n=s.execute.bind(s);
      s.execute=function(t,r) {
        if(this.has(t))return n(t,r);
        if(e.functions&&e.functions[t]) {
          const n=e.functions[t];
          for(let t=0;
          t<r.length;
          t++)e.vars["$"+(t+1)]=r[t];
          return x(n)
        }return Promise.resolve("sh: "+t+": command not found")
      },window.commandRouter=s,window.registerCommand=window.registerCommand||function(e,t){return s&&"function"==typeof s.register?(s.register(e,t),!0):!1}
    })(),setTimeout(E,200)
  }"loading"===document.readyState?document.addEventListener("DOMContentLoaded",O):O(),window.executeShellCommand=b,window.handleCommand=S,window._state=e,window.safeResolvePath=a
}();
