/**
 * Client 纯逻辑层测试（票 #4 / T3）：色板映射、色点收敛、悬停文案、输入规整。
 *
 * seam：client.js 工厂的 `logic` 导出（与 T1 同一测试通道，vm 直测不经 React/DOM）。
 * 名称规整额外与 Host 侧 tag-store.js 的实现做一致性对账（两端语义必须同拍）。
 */
import { describe, expect, it } from 'vitest';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTagName as hostNormalizeTagName } from '../tag-store.js';
import { createClientModule } from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { module } = createClientModule(path.join(here, '..', 'client.js'));
const { logic } = module;

describe('色板映射（一期固定色点，无颜色选择器）', () => {
  it('同名恒同色（纯函数、无随机源）', () => {
    for (const name of ['宁兰路桥', 'Obsidian', 'GTD', '法律', '']) {
      expect(logic.tagColorOf(name)).toBe(logic.tagColorOf(name));
    }
  });

  it('映射结果落在调色板内且非空字符串', () => {
    const names = ['a', 'b', 'c', '宁兰路桥', 'Obsidian', 'x'.repeat(64), '🎉', 'tag-with-dash'];
    for (const name of names) {
      expect(logic.TAG_PALETTE).toContain(logic.tagColorOf(name));
    }
  });

  it('调色板规模固定为 10 色，色值为可直接使用的 CSS 颜色', () => {
    expect(logic.TAG_PALETTE.length).toBe(10);
    for (const color of logic.TAG_PALETTE) expect(typeof color).toBe('string');
    // 纯逻辑层导出后，两处调用点（行色点与弹层）用同一张表。
    expect(new Set(logic.TAG_PALETTE).size).toBe(10);
  });

  it('不同名字有区分度：20 个名字至少命中 6 种颜色（确定性哈希不塌缩）', () => {
    const names = Array.from({ length: 20 }, (_, i) => `标签${i}`);
    const hits = new Set(names.map((name) => logic.tagColorOf(name)));
    expect(hits.size).toBeGreaterThanOrEqual(6);
  });
});

describe('色点收敛（16px leading 格，多标签并排）', () => {
  it('最多展示 3 个色点，超出收敛为计数', () => {
    expect(logic.visibleTagDots([])).toEqual({ visible: [], overflow: 0 });
    expect(logic.visibleTagDots(['a'])).toEqual({ visible: ['a'], overflow: 0 });
    expect(logic.visibleTagDots(['a', 'b', 'c'])).toEqual({ visible: ['a', 'b', 'c'], overflow: 0 });
    expect(logic.visibleTagDots(['a', 'b', 'c', 'd', 'e'])).toEqual({ visible: ['a', 'b', 'c'], overflow: 2 });
  });

  it('点径随数量收缩：1 个 8px、2 个 6px、3 个及以上 4px（含 1px 间隙都在 16px 内）', () => {
    expect(logic.tagDotSize(1)).toBe(8);
    expect(logic.tagDotSize(2)).toBe(6);
    expect(logic.tagDotSize(3)).toBe(4);
    expect(logic.tagDotSize(5)).toBe(4);
    for (const count of [1, 2, 3]) {
      expect(count * logic.tagDotSize(count) + (count - 1)).toBeLessThanOrEqual(16);
    }
  });

  it('悬停兜底文案：全部标签名以 · 连接（弹层/悬停卡未合入前 title 兜底）', () => {
    expect(logic.tagDotTitle(['a'])).toBe('a');
    expect(logic.tagDotTitle(['a', 'b'])).toBe('a · b');
    expect(logic.tagDotTitle([])).toBe('');
  });
});

describe('名称规整：Client 与 Host 两端同拍', () => {
  const samples = ['  Obsidian  ', 'obsidian', 'a  b', '', '   ', null, undefined, 42, '宁兰 路桥'];
  it('对同样本的输出逐一对齐', () => {
    for (const sample of samples) {
      expect(logic.normalizeTagName(sample)).toBe(hostNormalizeTagName(sample));
    }
  });

  it('Client 侧规整阻止空名发起建标签请求', () => {
    expect(logic.normalizeTagName('   ')).toBe('');
    expect(logic.normalizeTagName(undefined)).toBe('');
  });
});

describe('悬停卡扩展段：标签名行拼装（票 #4 AC 补口）', () => {
  it('每个标签一行 {name,color}：名字保序、色值来自 TAG_PALETTE', () => {
    const rows = logic.hoverTagRows(['a', '宁兰路桥']);
    expect(rows.map((row) => row.name)).toEqual(['a', '宁兰路桥']);
    expect(rows.length).toBe(2);
    for (const row of rows) expect(logic.TAG_PALETTE).toContain(row.color);
  });

  it('无标签 → 空行集（占用者渲染 null，扩展段整体不出现）', () => {
    expect(logic.hoverTagRows([])).toEqual([]);
    expect(logic.hoverTagRows(undefined)).toEqual([]);
  });

  it('状态点占用 leading 格（行首色点让位）时，悬停段仍全量可见：不收敛、与 leading 无耦合', () => {
    const names = ['t1', 't2', 't3', 't4', 't5'];
    // 对照：行首色点面在 >3 时收敛（且状态点占用时整个让位不渲染）。
    expect(logic.visibleTagDots(names).visible.length).toBe(3);
    // 悬停段没有 16px 限制：同一份标签名全量列出。
    expect(logic.hoverTagRows(names).map((row) => row.name)).toEqual(names);
  });
});
