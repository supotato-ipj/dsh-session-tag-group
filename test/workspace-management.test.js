/**
 * T2 纯逻辑层测试：workspace 管理与归档（票 #3）。
 * 行为对齐内置源码行号（T1 缓存抽取件 .tmp-research/uiw-client.js）：
 * - distinguishingPathSuffixes：uiw client.js:2697-2712
 * - workspaceRenameReview：uiw client.js:1805-1807（WorkspaceDialogs 校验规则）
 * 测试 seam：module.logic（spec「Testing Decisions」；只测输入→输出）。
 */
import { describe, expect, it } from 'vitest';

import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createClientModule } from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(here, '..', 'client.js');
const { module } = createClientModule(clientPath);
const logic = module.logic;

describe('distinguishingPathSuffixes（同名工作区消歧后缀）', () => {
  it('标题唯一的工作区没有后缀条目', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: '宁兰路桥', path: '/home/work/ninglan' },
      { id: 'w2', title: 'Obsidian', path: '/home/notes' },
    ]);
    expect(suffixes.size).toBe(0);
  });

  it('同名工作区各取最短的可区分尾段，保留路径自身分隔符', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'lab', path: '/home/a/lab' },
      { id: 'w2', title: 'lab', path: '/home/b/lab' },
    ]);
    expect(suffixes.get('w1')).toBe('a/lab');
    expect(suffixes.get('w2')).toBe('b/lab');
  });

  it('尾段仍相同时加长到可区分为止（slice 取的是尾 N 个分段元素）', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'lab', path: '/home/x/lab' },
      { id: 'w2', title: 'lab', path: '/home/x/deep/lab' },
    ]);
    // count=1：两行尾段同为 'lab' → 加长；count=2：w1 尾 3 元素 'x/lab'，w2 尾 3 元素 'deep/lab'，可区分。
    expect(suffixes.get('w1')).toBe('x/lab');
    expect(suffixes.get('w2')).toBe('deep/lab');
  });

  it('Windows 反斜杠路径同样按分隔符分段', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'docs', path: 'C:\\work\\a\\docs' },
      { id: 'w2', title: 'docs', path: 'D:\\docs' },
    ]);
    expect(suffixes.get('w1')).toBe('a\\docs');
    expect(suffixes.get('w2')).toBe('D:\\docs');
  });

  it('三行同名的最小公共区分（逐 peer 比较，不满足就加长）', () => {
    const suffixes = logic.distinguishingPathSuffixes([
      { id: 'w1', title: 'p', path: '/r/one/p' },
      { id: 'w2', title: 'p', path: '/r/two/p' },
      { id: 'w3', title: 'q', path: '/r/one/q' },
    ]);
    expect(suffixes.get('w1')).toBe('one/p');
    expect(suffixes.get('w2')).toBe('two/p');
    expect(suffixes.has('w3')).toBe(false);
  });
});

describe('workspaceRenameReview（重命名对话框校验规则）', () => {
  const workspaces = [
    { workspaceId: 'w1', title: '宁兰路桥' },
    { workspaceId: 'w2', title: 'Obsidian' },
  ];
  const request = { action: 'rename', workspaceId: 'w1', displayTitle: '宁兰路桥', storedTitle: '宁兰路桥' };

  it('trim 后为空：blocked 且无 duplicate', () => {
    const review = logic.workspaceRenameReview('   ', request, workspaces, false);
    expect(review).toEqual({ trimmed: '', duplicate: false, blocked: true });
  });

  it('与存储标题相同（未改动）：blocked', () => {
    const review = logic.workspaceRenameReview('  宁兰路桥 ', request, workspaces, false);
    expect(review.blocked).toBe(true);
    expect(review.duplicate).toBe(false);
  });

  it('与其他 workspace 标题重名：blocked 且 duplicate 告警（比较存储标题，排除自身）', () => {
    const review = logic.workspaceRenameReview('Obsidian', request, workspaces, false);
    expect(review.duplicate).toBe(true);
    expect(review.blocked).toBe(true);
  });

  it('合法新名：不 blocked、无 duplicate，trimmed 去首尾空白', () => {
    const review = logic.workspaceRenameReview('  宁兰二标  ', request, workspaces, false);
    expect(review).toEqual({ trimmed: '宁兰二标', duplicate: false, blocked: false });
  });

  it('提交进行中（renaming）一律 blocked；无 request 时也 blocked', () => {
    expect(logic.workspaceRenameReview('x', request, workspaces, true).blocked).toBe(true);
    expect(logic.workspaceRenameReview('x', null, workspaces, false).blocked).toBe(true);
  });

  it('重名检查对默认工作区同样生效（传入的是映射后的标题列表）', () => {
    const mapped = [...workspaces, { workspaceId: 'w3', title: '默认工作区' }];
    const review = logic.workspaceRenameReview('默认工作区', request, mapped, false);
    expect(review.duplicate).toBe(true);
  });
});
