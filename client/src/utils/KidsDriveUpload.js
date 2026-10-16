export async function uploadKidsWorkbook(filename, filedata, uploadRevision, snapshot, serverUrl = '') {
  const response = await fetch(`${serverUrl}/api/kids/drive-upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, filedata, uploadRevision, snapshot })
  });
  const receipt = await response.json();
  if (!response.ok || receipt.status !== 'success' || receipt.protocol !== 'two-kids-excel-v1' ||
      receipt.fileName !== filename || receipt.storedRevision !== uploadRevision || !receipt.fileId) {
    throw new Error(receipt.message || 'Google Drive has not confirmed the save');
  }
  return receipt;
}
