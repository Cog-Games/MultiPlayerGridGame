import { createHash } from 'node:crypto';

export const TWO_KIDS_FOLDER_ID = '1j8v13wvo8XLa8dLDBtPxVDV_egBMRHyu';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyfQ-XKsoFbmQZGM7c741rEXh2ZUpVK-uUIu9ycooXKnaxM5-hRSzIUhQ-uWZ668Qql/exec';

export async function uploadKidsWorkbook(body, { fetchImpl = fetch, endpoint = process.env.GOOGLE_APPS_SCRIPT_URL || process.env.VITE_GOOGLE_APPS_SCRIPT_URL || DEFAULT_ENDPOINT } = {}) {
  const { filename, filedata, uploadRevision, snapshot } = body || {};
  if (!/^experiment_data_[A-Za-z0-9_-]+\.xlsx$/.test(filename || '') || filename.length > 250 ||
      typeof filedata !== 'string' || filedata.length > 20000000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(filedata) ||
      !Number.isSafeInteger(uploadRevision) || uploadRevision < 1 || typeof snapshot !== 'boolean') {
    throw new Error('Invalid two-kids workbook upload');
  }
  const bytes = Buffer.from(filedata, 'base64');
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('Expected an XLSX workbook');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const response = await fetchImpl(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(45000),
    body: new URLSearchParams({ studyId: 'two-kids', protocol: 'two-kids-excel-v1',
      filetype: 'excel', filename, filedata, upsert: 'true', snapshot: String(snapshot),
      uploadRevision: String(uploadRevision) })
  });
  if (!response.ok) throw new Error(`Drive endpoint returned HTTP ${response.status}`);
  const receipt = await response.json();
  if (receipt.status !== 'success' || receipt.protocol !== 'two-kids-excel-v1' ||
      receipt.folderId !== TWO_KIDS_FOLDER_ID || receipt.fileName !== filename ||
      !receipt.fileId || receipt.sha256 !== sha256 || receipt.storedRevision !== uploadRevision) {
    throw new Error(receipt.message || 'Drive did not confirm this workbook and revision');
  }
  return receipt;
}
