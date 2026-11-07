import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 纯逻辑层不需要 DOM（06 笔记 §2；spec Testing Decisions：UI 渲染层不做自动化测试）。
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
