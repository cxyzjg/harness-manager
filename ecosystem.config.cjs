/**
 * pm2 进程守护配置 (#2 工业级补强)
 *
 * 用法:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs     # 启动守护(崩溃自动重启)
 *   pm2 logs harness-manager           # 查看日志
 *   pm2 save                           # 保存进程列表(重启机器后 pm2 resurrect 恢复)
 *   pm2 stop harness-manager           # 停止
 *
 * 说明: Windows 下开机自启需额外安装 pm2-windows-startup:
 *   npm install -g pm2-windows-startup && pm2-startup install
 */
module.exports = {
  apps: [
    {
      name: "harness-manager",
      script: "npx",
      args: "tsx src/cli.ts serve",
      cwd: __dirname,
      watch: false, // 不监听文件变化(会话文件高频写入)
      max_memory_restart: "500M", // 内存超500M自动重启(防御泄漏)
      restart_delay: 3000, // 崩溃后3秒再拉起
      env: {
        NODE_ENV: "production",
      },
      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      merge_logs: true,
      time: true, // 日志带时间戳
    },
  ],
};
