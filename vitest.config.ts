import { defineConfig } from "vitest/config";

/**
 * 测试配置：
 * - fileParallelism: false —— 串行运行测试文件，避免多个测试文件共享
 *   全局 ~/.harness-manager/cache.json 时的相互污染（apply/onboard 测试都会写缓存）
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 15000,
  },
});
