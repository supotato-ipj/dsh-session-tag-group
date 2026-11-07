/**
 * client.js 形状护栏（对齐黄金样本 client-single-file.test.js 的精神）：
 * 单一入口、id 等于包名、注入面声明完整、locale 词表与文件一致、禁止顶层 require。
 */
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadClientArtifact } from './helpers/client-artifact.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(here, '..');
const clientPath = path.join(appRoot, 'client.js');
const clientSource = readFileSync(clientPath, 'utf8');
const packageJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

describe('client.js 单文件约束', () => {
  it('只有一个 window.__ModuleLoader__.load 入口', () => {
    const entries = clientSource.match(/^\s*window\.__ModuleLoader__\.load\s*\(/gm) ?? [];
    expect(entries.length).toBe(1);
  });

  it('id 必须等于包名 @local/dsh-session-tags', () => {
    const artifact = loadClientArtifact(clientPath);
    expect(artifact.id).toBe(packageJson.name);
    expect(packageJson.name).toBe('@local/dsh-session-tags');
  });

  it('工厂顶层不 require（React/primitives 只在 apply 里解析，保证 vm 直测 logic）', () => {
    // 工厂体在 `factory(require)` 里；其顶层出现 require(...) 调用即违规
    // （组件/apply 内的惰性 require 不在此列——它们在调用点才求值）。
    const factoryMatch = clientSource.match(/factory\(require\) \{([\s\S]*?)\n    return \{/);
    expect(factoryMatch).not.toBeNull();
    const factoryTop = factoryMatch[1];
    expect(factoryTop).not.toMatch(/=\s*require\(/);
    expect(factoryTop).not.toMatch(/^\s*const\s+\w+\s*=\s*require\(/m);
  });

  it('导出纯逻辑层 logic 与 inject 声明', () => {
    const { module } = (() => {
      const artifact = loadClientArtifact(clientPath);
      return { module: artifact.factory(() => { throw new Error('no require'); }) };
    })();
    expect(Array.isArray(module.inject)).toBe(true);
    expect(module.inject).toContain('slots');
    expect(module.inject).toContain('uiWorkspace');
    expect(typeof module.apply).toBe('function');
    expect(typeof module.logic.orderByRecency).toBe('function');
    expect(typeof module.logic.reconcileManualOrder).toBe('function');
    expect(typeof module.logic.viewOptionsMenuModel).toBe('function');
    expect(typeof module.logic.workspaceViewStoreSpec).toBe('function');
  });
});

describe('清单（package.json / cordis.patch.yml）', () => {
  const patchYml = readFileSync(path.join(appRoot, 'cordis.patch.yml'), 'utf8');

  it('dsh.bundle.patch 与 dsh.client 清单齐备，inject 照抄内置 ui-workspace', () => {
    expect(packageJson.dsh.bundle.patch).toBe('./cordis.patch.yml');
    expect(packageJson.dsh.client.platform).toBe('web');
    expect(packageJson.dsh.client.immediately).toBe(true);
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-api-session-controller');
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-api-workspace-controller');
    expect(packageJson.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-sidebar');
    expect(packageJson.engines.dsh).toBe('>=0.2.2-rc.1 <0.3.0');
    expect(packageJson.exports['./client']).toBe('./client.js');
    expect(packageJson.exports['./icon']).toBe('./icon.svg');
  });

  it('cordis.patch.yml 插入行 id=dsh-session-tags，name=@local/dsh-session-tags', () => {
    expect(patchYml).toContain('id: dsh-session-tags');
    expect(patchYml).toContain("name: '@local/dsh-session-tags'");
  });
});

describe('locale 词表（client 内联 与 locale/*.json 不漂移）', () => {
  it('zh/en JSON 存在且带 meta.title=会话标签（zh）', () => {
    const zh = JSON.parse(readFileSync(path.join(appRoot, 'locale', 'zh.json'), 'utf8'));
    const en = JSON.parse(readFileSync(path.join(appRoot, 'locale', 'en.json'), 'utf8'));
    expect(zh.meta.title).toBe('会话标签');
    expect(typeof zh.meta.description).toBe('string');
    expect(en.meta.title).toBe('Session Tags');
  });

  it('client.js 内联词表与 locale/*.json 键集一致（文件是元数据超集，允许 meta/copy 差异键）', () => {
    const zhJson = JSON.parse(readFileSync(path.join(appRoot, 'locale', 'zh.json'), 'utf8'));
    const enJson = JSON.parse(readFileSync(path.join(appRoot, 'locale', 'en.json'), 'utf8'));
    const inlineZh = clientSource.match(/const zh = \{([\s\S]*?)\n    \};/);
    const inlineEn = clientSource.match(/const en = \{([\s\S]*?)\n    \};/);
    expect(inlineZh).not.toBeNull();
    expect(inlineEn).not.toBeNull();
    const keys = (block) => [...block.matchAll(/'([^']+)':/g)].map((m) => m[1]);
    const inlineZhKeys = new Set(keys(inlineZh[1]));
    const inlineEnKeys = new Set(keys(inlineEn[1]));
    const fileZhKeys = new Set(Object.keys(zhJson).filter((key) => key !== 'meta'));
    const fileEnKeys = new Set(Object.keys(enJson).filter((key) => key !== 'meta'));
    // 内联词表 ⊆ 文件词表；文件词表允许 meta 之外的少量宿主共用键（copy）。
    for (const key of inlineZhKeys) expect(fileZhKeys.has(key), 'zh 缺键 ' + key).toBe(true);
    for (const key of inlineEnKeys) expect(fileEnKeys.has(key), 'en 缺键 ' + key).toBe(true);
    expect(inlineZhKeys.size).toBe(inlineEnKeys.size);
  });
});

describe('icon.svg 原创性', () => {
  it('是真 SVG（含 path），不是占位圆', () => {
    const svg = readFileSync(path.join(appRoot, 'icon.svg'), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
    // 占位圆守卫：不含以 circle 为主体的图形（圆孔是标签造型的一部分，允许一个小 circle）。
    const circles = svg.match(/<circle/g) ?? [];
    expect(circles.length).toBeLessThanOrEqual(1);
    expect(svg).toContain('viewBox="0 0 64 64"');
  });
});
