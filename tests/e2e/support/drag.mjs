/**
 * 在页面里构造一个带 File 的 DataTransfer，用于真实触发拖拽导入的事件处理。
 * 不使用 CDP 的 setInputFiles，保证走的是 dragenter/dragover/drop 这条路径。
 */
export async function makeFilesTransfer(page, files) {
  return page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      transfer.items.add(new File([item.content], item.name, { type: item.type || 'application/json' }));
    }
    return transfer;
  }, files);
}

export async function dragFilesInto(page, zoneSelector, files) {
  const transfer = await makeFilesTransfer(page, files);
  await page.dispatchEvent(zoneSelector, 'dragenter', { dataTransfer: transfer });
  await page.dispatchEvent(zoneSelector, 'dragover', { dataTransfer: transfer });
  await page.dispatchEvent(zoneSelector, 'drop', { dataTransfer: transfer });
  return transfer;
}

/** 图层树拖拽：用真实的 dragstart / dragover / drop 事件，指定落点在目标行顶部或底部。 */
export async function dragLayerRow(page, fromPath, toPath, position) {
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  const from = page.locator('[data-layer-tree] .lc-tree-item[data-path="' + fromPath + '"]');
  const to = page.locator('[data-layer-tree] .lc-tree-item[data-path="' + toPath + '"]');
  const box = await to.boundingBox();
  const clientY = box ? (position === 'after' ? box.y + box.height - 2 : box.y + 2) : 0;

  await from.dispatchEvent('dragstart', { dataTransfer: transfer });
  await to.dispatchEvent('dragover', { dataTransfer: transfer, clientX: box ? box.x + 10 : 0, clientY });
  await to.dispatchEvent('drop', { dataTransfer: transfer, clientX: box ? box.x + 10 : 0, clientY });
  await from.dispatchEvent('dragend', { dataTransfer: transfer });
}
