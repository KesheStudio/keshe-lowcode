/* 数据源 · 导入解析
 *
 * CSV / JSON → 列映射 → 类型推断 → 前 20 行预览 → 冲突策略。
 * 所有上限来自 DATA_LIMITS，超限返回具体数字，不静默失败。 */
import {
  DATA_LIMITS,
  fail,
  FIELD_TYPE_LABELS,
  normalizeRow,
  checkUniqueness,
  prepareRows,
  defaultForField
} from './model.js';

export const IMPORT_MODES = ['append', 'overwrite', 'skipDuplicates'];

export const IMPORT_MODE_LABELS = {
  append: '追加（冲突行跳过，其余新增）',
  overwrite: '覆盖（按唯一键更新已有行，未匹配则新增）',
  skipDuplicates: '跳过重复（整行完全相同的记录不导入）'
};

function byteSize(content) {
  return Buffer.byteLength(String(content), 'utf8');
}

export function assertImportLimits(content, rowCount) {
  const sizeBytes = byteSize(content);
  if (sizeBytes > DATA_LIMITS.importBytes) {
    throw fail(422, 'LC_E_IMPORT_TOO_LARGE',
      '导入文件 ' + sizeBytes + ' 字节，超过上限 ' + DATA_LIMITS.importBytes + ' 字节（5 MB）',
      { sizeBytes, limitBytes: DATA_LIMITS.importBytes });
  }
  if (rowCount > DATA_LIMITS.importRows) {
    throw fail(422, 'LC_E_IMPORT_TOO_MANY_ROWS',
      '导入 ' + rowCount + ' 行，超过单次上限 ' + DATA_LIMITS.importRows + ' 行（可拆成多次导入）',
      { rowCount, limitRows: DATA_LIMITS.importRows });
  }
  return sizeBytes;
}

export function detectFormat(content, format) {
  const wanted = String(format || 'auto').toLowerCase();
  if (wanted === 'csv' || wanted === 'json') return wanted;
  const textValue = String(content || '').trim();
  if (textValue.startsWith('{') || textValue.startsWith('[')) return 'json';
  return 'csv';
}

export function parseCsv(input) {
  const textValue = String(input == null ? '' : input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!textValue.trim()) throw fail(422, 'LC_E_IMPORT_FORMAT', 'CSV 内容为空');

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let dirty = false;
  for (let index = 0; index < textValue.length; index += 1) {
    const ch = textValue[index];
    if (inQuotes) {
      if (ch === '"') {
        if (textValue[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
        dirty = true;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      dirty = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
      dirty = true;
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      dirty = true;
    } else {
      cell += ch;
      dirty = true;
    }
  }
  if (dirty || cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((value) => String(value).trim() === '')) rows.pop();
  if (!rows.length) throw fail(422, 'LC_E_IMPORT_FORMAT', 'CSV 没有可导入的内容');

  const seen = new Map();
  const headers = rows[0].map((header, index) => {
    let name = String(header == null ? '' : header).trim() || ('column_' + (index + 1));
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (count > 1) name = name + '_' + count;
    return name;
  });
  const body = rows.slice(1).filter((cells) => cells.some((value) => String(value == null ? '' : value).trim() !== ''));
  const objects = body.map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] === undefined ? '' : cells[index];
    });
    return item;
  });
  return { headers, rows: objects };
}

export function parseJson(input) {
  let parsed;
  try {
    parsed = JSON.parse(String(input == null ? '' : input));
  } catch (error) {
    throw fail(422, 'LC_E_IMPORT_FORMAT', 'JSON 解析失败：请检查是否有多余逗号、缺失引号或未闭合的括号');
  }
  let list;
  if (Array.isArray(parsed)) list = parsed;
  else if (parsed && Array.isArray(parsed.rows)) list = parsed.rows;
  else if (parsed && Array.isArray(parsed.data)) list = parsed.data;
  else {
    throw fail(422, 'LC_E_IMPORT_FORMAT', 'JSON 需要是对象数组，或包含 rows / data 数组的对象');
  }
  if (!list.length) throw fail(422, 'LC_E_IMPORT_FORMAT', 'JSON 没有可导入的记录');
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw fail(422, 'LC_E_IMPORT_FORMAT', 'JSON 第 ' + (index + 1) + ' 条不是对象');
    }
  }
  const headers = [];
  for (const item of list) {
    for (const key of Object.keys(item)) {
      if (headers.indexOf(key) === -1) headers.push(key);
    }
  }
  return { headers, rows: list };
}

export function parseContent(content, format) {
  const resolved = detectFormat(content, format);
  const parsed = resolved === 'json' ? parseJson(content) : parseCsv(content);
  return Object.assign({ format: resolved }, parsed);
}

/* 类型推断只用于预览提示；真正落库仍以字段声明类型为准。 */
export function inferType(values) {
  const list = (values || []).filter((value) => value !== null && value !== undefined &&
    !(typeof value === 'string' && value.trim() === '')).slice(0, 2000);
  if (!list.length) return 'text';

  const allBoolean = list.every((value) => typeof value === 'boolean' || /^(true|false)$/i.test(String(value).trim()));
  if (allBoolean) return 'boolean';

  const allNumber = list.every((value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    return /^-?\d+(\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value));
  });
  if (allNumber) return 'number';

  const allDate = list.every((value) => typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}([ T].*)?$/.test(value.trim()) && Number.isFinite(Date.parse(value)));
  if (allDate) return 'date';

  const allJson = list.every((value) => {
    if (typeof value === 'object') return true;
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!/^[\[{]/.test(trimmed)) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  });
  if (allJson) return 'json';

  return 'text';
}

export function suggestMapping(headers, fields) {
  const byId = new Map(fields.map((field) => [field.id.toLowerCase(), field.id]));
  const byName = new Map(fields.map((field) => [String(field.name).toLowerCase(), field.id]));
  const mapping = {};
  for (const header of headers) {
    const key = String(header).trim().toLowerCase();
    mapping[header] = byId.get(key) || byName.get(key) || '';
  }
  return mapping;
}

export function buildPreview(collection, content, format) {
  /* 先做体积上限校验，避免把 60 MB 文本整段解析后才拒绝。 */
  assertImportLimits(content, 0);
  const parsed = parseContent(content, format);
  const sizeBytes = assertImportLimits(content, parsed.rows.length);
  const mapping = suggestMapping(parsed.headers, collection.fields);
  const columns = parsed.headers.map((header) => {
    const values = parsed.rows.slice(0, 2000).map((row) => row[header]);
    return {
      name: header,
      inferredType: inferType(values),
      inferredLabel: FIELD_TYPE_LABELS[inferType(values)],
      mappedTo: mapping[header] || '',
      samples: values.slice(0, 3).map((value) => (typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value)))
    };
  });
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const warnings = [];
  if (!mappedCount) {
    warnings.push({ code: 'LC_W_IMPORT_NO_MAPPING', message: '没有列能自动对应到集合字段，请在「导入到字段」里手动选择。' });
  }
  if (sizeBytes > DATA_LIMITS.importBytes * 0.8) {
    warnings.push({ code: 'LC_W_IMPORT_NEAR_LIMIT', message: '文件已接近 5 MB 上限，接近时可能被拒绝。' });
  }
  if (parsed.rows.length > DATA_LIMITS.previewRows) {
    warnings.push({
      code: 'LC_W_IMPORT_PREVIEW_TRUNCATED',
      message: '共 ' + parsed.rows.length + ' 行，下方只预览前 ' + DATA_LIMITS.previewRows + ' 行。'
    });
  }
  return {
    format: parsed.format,
    sizeBytes,
    limitBytes: DATA_LIMITS.importBytes,
    rowLimit: DATA_LIMITS.importRows,
    totalRows: parsed.rows.length,
    previewRows: DATA_LIMITS.previewRows,
    columns,
    mapping,
    fields: collection.fields.map((field) => ({ id: field.id, name: field.name, type: field.type, typeLabel: FIELD_TYPE_LABELS[field.type] })),
    rows: parsed.rows.slice(0, DATA_LIMITS.previewRows),
    warnings
  };
}

function mappedValue(field, raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string' && raw.trim() === '') return undefined;
  if (field.type === 'json') {
    if (typeof raw === 'string') return raw;
    return raw;
  }
  if (typeof raw === 'object') return JSON.stringify(raw);
  return raw;
}

function rowSignature(row, fieldIds) {
  return fieldIds.map((id) => JSON.stringify(row[id] === undefined ? null : row[id])).join('\u0000');
}

function uniqueSpecs(collection) {
  const specs = [];
  for (const field of collection.fields) {
    if (field.unique) specs.push({ label: '字段「' + field.name + '」', fields: [field.id] });
  }
  for (const index of collection.indexes || []) {
    if (index.unique && index.fields.length) specs.push({ label: '索引「' + index.name + '」', fields: index.fields.slice() });
  }
  return specs;
}

function matchesSpec(row, other, spec) {
  return spec.fields.every((id) => JSON.stringify(row[id] === undefined ? null : row[id]) ===
    JSON.stringify(other[id] === undefined ? null : other[id]));
}

/**
 * 执行导入，返回结果与新的行数组；不写文件，由路由负责落盘。
 */
export function runImport(collection, content, options) {
  const format = options && options.format;
  const mode = IMPORT_MODES.includes(options && options.mode) ? options.mode : 'append';
  /* 先做体积上限校验，避免把超大文本整段解析后才拒绝。 */
  assertImportLimits(content, 0);
  const parsed = parseContent(content, format);
  const sizeBytes = assertImportLimits(content, parsed.rows.length);

  const mappingInput = options && options.mapping;
  const mapping = mappingInput && typeof mappingInput === 'object'
    ? mappingInput
    : suggestMapping(parsed.headers, collection.fields);

  const fieldIds = new Set(collection.fields.map((field) => field.id));
  const usedFields = new Set();
  const mappedColumns = [];
  for (const header of parsed.headers) {
    const fieldId = mapping[header];
    if (!fieldId) continue;
    if (!fieldIds.has(fieldId)) {
      throw fail(400, 'LC_E_IMPORT_MAPPING', '列「' + header + '」映射到了不存在的字段：' + fieldId);
    }
    if (usedFields.has(fieldId)) {
      throw fail(400, 'LC_E_IMPORT_MAPPING', '字段「' + fieldId + '」被多列重复映射');
    }
    usedFields.add(fieldId);
    mappedColumns.push({ header, fieldId });
  }
  if (!mappedColumns.length) {
    throw fail(400, 'LC_E_IMPORT_MAPPING', '至少需要把一列映射到集合字段');
  }

  const mappedFieldIds = mappedColumns.map((item) => item.fieldId);
  const fields = collection.fields;
  const rows = collection.rows.slice();
  const specs = uniqueSpecs(collection);
  if (mode === 'overwrite' && !specs.length) {
    throw fail(422, 'LC_E_IMPORT_OVERWRITE_NO_KEY',
      '覆盖模式需要集合至少有一个唯一字段或唯一索引，当前集合没有，无法判断覆盖哪一行');
  }

  const issues = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let issueCount = 0;

  function report(rowNumber, reason, kind) {
    issueCount += 1;
    if (issues.length < 50) {
      issues.push({ row: rowNumber, reason, kind: kind || 'skipped' });
    }
  }

  for (let index = 0; index < parsed.rows.length; index += 1) {
    const source = parsed.rows[index];
    const rowNumber = index + 1;
    const candidate = {};
    for (const item of mappedColumns) {
      const field = fields.find((entry) => entry.id === item.fieldId);
      candidate[item.fieldId] = mappedValue(field, source[item.header]);
    }

    let normalized;
    try {
      normalized = normalizeRow(fields, candidate, { strict: false });
    } catch (error) {
      failed += 1;
      report(rowNumber, '数据格式错误：' + error.message, 'failed');
      continue;
    }

    if (mode === 'skipDuplicates') {
      const signature = rowSignature(normalized, mappedFieldIds);
      const exists = rows.some((row) => rowSignature(row, mappedFieldIds) === signature);
      if (exists) {
        skipped += 1;
        report(rowNumber, '整行内容与已有记录完全相同，已跳过');
        continue;
      }
    }

    if (mode === 'overwrite') {
      const matched = [];
      for (const spec of specs) {
        const found = rows.find((row) => matchesSpec(normalized, row, spec));
        if (found) matched.push({ spec, row: found });
      }
      const ids = Array.from(new Set(matched.map((item) => item.row.id)));
      if (ids.length > 1) {
        failed += 1;
        report(rowNumber, '同时匹配到多行（' + ids.length + ' 行），无法确定覆盖目标', 'failed');
        continue;
      }
      if (ids.length === 1) {
        const target = matched[0].row;
        /* 只覆盖本次明确映射的列；未映射的列保留原值，避免只导入两列就把其它字段清空。 */
        const replacement = Object.assign({}, target, { id: target.id });
        for (const item of mappedColumns) replacement[item.fieldId] = normalized[item.fieldId];
        try {
          const others = rows.filter((row) => row.id !== target.id);
          checkUniqueness(collection, replacement, target.id, others);
        } catch (error) {
          skipped += 1;
          report(rowNumber, '覆盖会违反唯一约束：' + error.message);
          continue;
        }
        const targetIndex = rows.findIndex((row) => row.id === target.id);
        rows[targetIndex] = replacement;
        updated += 1;
        continue;
      }
    }

    try {
      checkUniqueness(collection, Object.assign({ id: 'pending' }, normalized), '', rows);
    } catch (error) {
      skipped += 1;
      report(rowNumber, error.message);
      continue;
    }

    const created = prepareRows(collection, [normalized], { strict: false })[0];
    rows.push(created);
    added += 1;
  }

  if (rows.length > DATA_LIMITS.rowsPerCollection) {
    throw fail(422, 'LC_E_DATA_LIMIT',
      '导入后集合会有 ' + rows.length + ' 行，超过单集合上限 ' + DATA_LIMITS.rowsPerCollection + ' 行',
      { rowCount: rows.length, limitRows: DATA_LIMITS.rowsPerCollection, added, updated, skipped });
  }

  return {
    mode,
    format: parsed.format,
    sizeBytes,
    totalRows: parsed.rows.length,
    rows,
    added,
    updated,
    skipped,
    failed,
    issueCount,
    issues,
    mapping: mappedColumns.reduce((out, item) => {
      out[item.header] = item.fieldId;
      return out;
    }, {})
  };
}
