// PM2 进程配置：pm2 start ecosystem.config.cjs
// 注意：首次需先交互式登录（npm start 扫码），账号保存到 ~/.pi-weixin-bridge/account.json 后，
// PM2 守护进程才能复用凭据运行（守护态无法扫码）。
module.exports = {
  apps: [
    {
      name: "pi-weixin-bridge",
      // 用 bin 包装器运行：其经 tsx/esm/api 在进程内注册并 import TS 源码，
      // 不像 tsx CLI 那样额外派生子 node 进程（那个子进程无 windowsHide，会在 Windows 启动时弹控制台框）。
      script: "bin/pi-weixin-bridge.js",
      cwd: __dirname,
      interpreter: "node",
      // fork 模式直接运行脚本（cluster 会包裹进程，与 tsx CLI 启动器不兼容，且影响 stdin 扫码）
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      // 崩溃后延迟重启，避免快速失败循环
      restart_delay: 3000,
      max_restarts: 10,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
      },
      out_file: "logs/out.log",
      error_file: "logs/err.log",
      merge_logs: true,
      // 日志带时间戳
      time: true,
    },
  ],
};
