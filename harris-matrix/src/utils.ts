export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 去掉 Vue 响应式代理，得到可结构化克隆的纯数据（写入 IndexedDB 前使用） */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
